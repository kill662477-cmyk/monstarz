// 자동 수집 작업 공통 로거 (CommonJS, Node 18+ fetch).
// GitHub Actions / 서버 수집 스크립트에서 사용합니다.
//
// 핵심 원칙:
//  - Supabase 환경변수(SUPABASE URL + service/secret 키)가 없으면 콘솔 로그만 남기고 조용히 통과.
//  - automation_runs 기록 실패가 절대 본 수집 작업 실패로 이어지지 않게 모든 호출을 try/catch 로 감쌈.
//  - service 키는 서버에서만 사용. 절대 브라우저로 가지 않음.
//
// 사용 예:
//   const { withAutomationLog } = require("./lib/automationLogger");
//   await withAutomationLog({ jobName: "collect-elo", jobType: "scheduled", source: "eloboard", target: "firebase" },
//     async (run) => {
//       const data = await collect();
//       run.itemsFound = data.length;
//       if (!data.length) { run.status = "skipped"; return; } // 0건이면 기존 데이터 보존
//       await save(data);
//       run.itemsWritten = data.length;
//     });

function getConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return { url, key, ready: Boolean(url && key) };
}

async function insertRun(row) {
  const cfg = getConfig();
  if (!cfg.ready) return false; // 미연결: 조용히 통과
  try {
    const res = await fetch(cfg.url + "/rest/v1/automation_runs", {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      console.warn("[automationLogger] automation_runs 기록 실패:", res.status);
      return false;
    }
    return true;
  } catch (e) {
    // 로깅 실패는 무시 (본 작업에 영향 주지 않음)
    console.warn("[automationLogger] automation_runs 기록 예외:", e.message);
    return false;
  }
}

// 수집 함수를 감싸 시작/종료/실패를 자동 기록.
// fn(run) 안에서 run.itemsFound / itemsWritten / itemsSkipped / status / meta 를 채우면 됩니다.
async function withAutomationLog(opts, fn) {
  const startedAt = new Date();
  let caughtError = null;
  const run = {
    jobName: opts.jobName,
    jobType: opts.jobType || null,
    source: opts.source || null,
    target: opts.target || null,
    status: "success",
    itemsFound: 0,
    itemsWritten: 0,
    itemsSkipped: 0,
    meta: opts.meta || null,
    errorMessage: null
  };

  console.log("[automation] start:", run.jobName);
  try {
    await fn(run);
  } catch (err) {
    caughtError = err;
    run.status = "failed";
    run.errorMessage = String((err && err.message) || err).slice(0, 1000);
    console.error("[automation] FAILED:", run.jobName, "-", run.errorMessage);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  console.log(
    "[automation] end:", run.jobName,
    "status=" + run.status,
    "found=" + run.itemsFound,
    "written=" + run.itemsWritten,
    "skipped=" + run.itemsSkipped,
    "(" + durationMs + "ms)"
  );

  await insertRun({
    job_name: run.jobName,
    job_type: run.jobType,
    status: run.status,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    source: run.source,
    target: run.target,
    items_found: run.itemsFound || 0,
    items_written: run.itemsWritten || 0,
    items_skipped: run.itemsSkipped || 0,
    error_message: run.errorMessage,
    meta: run.meta
  });

  if (caughtError && opts.rethrow !== false) {
    throw caughtError;
  }

  return run;
}

// 단순 1회 기록용 (이미 끝난 작업 결과를 남길 때)
async function logRun(row) {
  return insertRun({
    job_name: row.jobName || row.job_name || "unknown",
    job_type: row.jobType || row.job_type || null,
    status: row.status || "success",
    started_at: row.startedAt || row.started_at || null,
    finished_at: row.finishedAt || row.finished_at || new Date().toISOString(),
    duration_ms: row.durationMs || row.duration_ms || null,
    source: row.source || null,
    target: row.target || null,
    items_found: row.itemsFound || row.items_found || 0,
    items_written: row.itemsWritten || row.items_written || 0,
    items_skipped: row.itemsSkipped || row.items_skipped || 0,
    error_message: row.errorMessage || row.error_message || null,
    meta: row.meta || null
  });
}

module.exports = { withAutomationLog, logRun, getConfig };
