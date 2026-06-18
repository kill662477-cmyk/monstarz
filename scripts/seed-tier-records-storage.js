// 전적 원본을 Firebase RTDB -> Supabase Storage(tier-records 버킷, .json.gz)로 시딩.
// 이후 업데이트는 collect-data.js가 같은 경로를 덮어씁니다.
// 사용법(키는 셸 env로만 전달, 채팅/로그 노출 금지):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-tier-records-storage.js --dry-run
//   ... --apply
const { ensureBucket, uploadGzJson, DEFAULT_BUCKET } = require("../lib/supabase/storage");

const RTDB = (process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/+$/, "");
const FB_ROOT = process.env.FIREBASE_ROOT || "starcraftTier/current";
const RECORDS_BASE = RTDB + "/" + FB_ROOT + "/records";

function parseArgs() {
  const a = process.argv.slice(2);
  return { apply: a.includes("--apply"), dryRun: !a.includes("--apply") };
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("rtdb_fetch_" + res.status + " " + url);
  return res.json();
}

async function main() {
  const { dryRun } = parseArgs();
  console.log("\n=== tier-records 시딩 (" + (dryRun ? "DRY-RUN" : "APPLY") + ") ===");

  // 키 목록 (shallow: 값 없이 키만 — 큰 트리 전체 로드 방지)
  let keysObj;
  try {
    keysObj = await getJson(RECORDS_BASE + ".json?shallow=true");
  } catch (e) {
    console.error("[중단] RTDB records 키 목록 조회 실패:", e.message);
    process.exit(1);
  }
  const keys = keysObj && typeof keysObj === "object" ? Object.keys(keysObj) : [];
  console.log("RTDB records 키: " + keys.length + "개");
  if (!keys.length) {
    console.log("RTDB에 records가 없습니다. (이미 Storage로 이전됐거나 경로 확인 필요)");
    return;
  }

  if (dryRun) {
    console.log("DRY-RUN: 업로드 안 함. 키 미리보기:");
    keys.slice(0, 10).forEach(function (k, i) { console.log("  [" + (i + 1) + "] records/" + k + ".json.gz"); });
    if (keys.length > 10) console.log("  ... +" + (keys.length - 10) + "개");
    console.log("적용하려면 --apply 로 실행하세요.");
    return;
  }

  await ensureBucket(DEFAULT_BUCKET);
  let ok = 0, fail = 0, skip = 0, totalGz = 0;
  for (const key of keys) {
    try {
      const records = await getJson(RECORDS_BASE + "/" + encodeURIComponent(key) + ".json");
      if (records === null || records === undefined) { skip++; continue; }
      const r = await uploadGzJson(DEFAULT_BUCKET, "records/" + key + ".json.gz", records);
      totalGz += r.size;
      ok++;
      if (ok % 5 === 0) console.log("  ...업로드 " + ok + "/" + keys.length);
    } catch (e) {
      fail++;
      console.error("  업로드 실패:", key, "-", e.message);
    }
  }
  console.log("완료: 성공 " + ok + ", 건너뜀 " + skip + ", 실패 " + fail + " (총 gz " + Math.round(totalGz / 1024) + "KB)");
}

main().catch(function (e) { console.error(e); process.exit(1); });
