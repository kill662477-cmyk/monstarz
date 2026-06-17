// Supabase import 공통 코어 (CommonJS, Node 18+ 의 전역 fetch 사용)
// - 환경변수(SUPABASE URL + service/secret 키)가 없으면 즉시 중단
// - --dry-run(기본) / --apply
// - onConflict 가 있으면 PostgREST upsert(merge-duplicates), 없으면 matchKey 로 중복 제거 후 insert
// - 실행 전후 건수 + 실패 항목 로그

const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY_ENV = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  return { apply: apply, dryRun: !apply };
}

function ensureEnv() {
  if (!URL_ENV || !KEY_ENV) {
    console.error("[중단] Supabase 환경변수가 없습니다.");
    console.error("  예) SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node " + process.argv[1] + " --dry-run");
    process.exit(1);
  }
  return { url: String(URL_ENV).replace(/\/+$/, ""), key: KEY_ENV };
}

async function rest(method, table, options) {
  options = options || {};
  const cfg = ensureEnv();
  const headers = {
    apikey: cfg.key,
    Authorization: "Bearer " + cfg.key,
    "Content-Type": "application/json"
  };
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(cfg.url + "/rest/v1/" + table + (options.query || ""), {
    method: method,
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.message) || "supabase_request_failed");
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function runImport(opts) {
  const table = opts.table;
  const rows = opts.rows || [];
  const matchKey = opts.matchKey;
  const onConflict = opts.onConflict;
  const label = opts.label || table;
  const { dryRun } = parseArgs();

  console.log("\n=== " + label + " import (" + (dryRun ? "DRY-RUN" : "APPLY") + ") ===");
  console.log("source rows: " + rows.length);
  if (!rows.length) {
    console.log("source 가 비어 있습니다. 스크립트 상단 SOURCE 를 채우거나 원본을 확인하세요.");
    return;
  }
  ensureEnv();

  let toInsert = rows;
  if (!onConflict && matchKey) {
    const existing = await rest("GET", table, { query: "?select=*" });
    const seen = new Set((existing || []).map(matchKey));
    toInsert = rows.filter(function (r) { return !seen.has(matchKey(r)); });
    console.log("existing: " + (existing || []).length + ", new(after dedupe): " + toInsert.length);
  }

  if (dryRun) {
    console.log("DRY-RUN: 실제로 쓰지 않습니다. 미리보기 5건:");
    toInsert.slice(0, 5).forEach(function (r, i) { console.log("  [" + (i + 1) + "] " + JSON.stringify(r)); });
    if (toInsert.length > 5) console.log("  ... +" + (toInsert.length - 5) + "건");
    console.log("적용하려면 --apply 로 다시 실행하세요.");
    return;
  }

  if (!toInsert.length) {
    console.log("새로 넣을 행이 없습니다 (이미 반영됨).");
    return;
  }

  let okCount = 0, failCount = 0;
  if (onConflict) {
    try {
      const out = await rest("POST", table, {
        query: "?on_conflict=" + onConflict,
        body: toInsert,
        prefer: "resolution=merge-duplicates,return=representation"
      });
      okCount = (out || []).length;
    } catch (e) {
      failCount = toInsert.length;
      console.error("upsert 실패:", e.message, e.details || "");
    }
  } else {
    for (const row of toInsert) {
      try {
        await rest("POST", table, { body: row, prefer: "return=minimal" });
        okCount++;
      } catch (e) {
        failCount++;
        console.error("insert 실패:", matchKey ? matchKey(row) : JSON.stringify(row), "-", e.message);
      }
    }
  }
  console.log("완료: 성공 " + okCount + ", 실패 " + failCount);
}

module.exports = { parseArgs, ensureEnv, rest, runImport };
