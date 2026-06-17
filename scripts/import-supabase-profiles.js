// 프로필 탭 데이터(PROFILE_MEMBERS) -> member_profiles 로 import
// index.html 의 PROFILE_MEMBERS 배열을 런타임에 추출하므로 별도 동기화가 필요 없습니다.
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-profiles.js --dry-run
//   ... --apply
const fs = require("fs");
const path = require("path");
const { runImport } = require("./_supabase-import-core");

function extractProfileMembers() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const markerIdx = html.indexOf("var PROFILE_MEMBERS");
  if (markerIdx === -1) return [];
  const start = html.indexOf("[", markerIdx);
  if (start === -1) return [];
  let depth = 0, end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  const literal = html.slice(start, end + 1);
  try {
    return new Function("return (" + literal + ");")();
  } catch (e) {
    console.error("PROFILE_MEMBERS 파싱 실패:", e.message);
    return [];
  }
}

const source = extractProfileMembers();
const rows = source.map(function (p, i) {
  return {
    name: p.name,
    role: p.role || null,
    image: p.image || null,
    fallback_image: p.fallbackImage || null,
    image_pos: p.imagePos || null,
    birth: p.birth || null,
    blood: p.blood || null,
    mbti: p.mbti || null,
    height: p.height || null,
    debut: p.debut || null,
    awards: Array.isArray(p.awards) && p.awards.length ? p.awards.join("\n") : null,
    sort_order: i
  };
}).filter(function (r) { return r.name; });

runImport({
  table: "member_profiles",
  rows: rows,
  matchKey: function (r) { return r.name; },
  label: "member_profiles"
}).catch(function (e) { console.error(e); process.exit(1); });
