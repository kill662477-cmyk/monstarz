// 일정 -> schedules 로 import.
// 현재 일정은 외부 일정표(netlify) 임베드로 운영되어 구조화된 원본이 없습니다.
// 수동 일정을 옮기려면 아래 SOURCE 에 직접 채운 뒤 실행하세요.
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-schedules.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

// 예시 형식:
// { title: "정기 리그", start_at: "2026-07-01T20:00:00+09:00", event_date: "2026-07-01",
//   description: "주간 정기전", members: ["김윤환","토마토"], status: "scheduled", sort_order: 0 }
const SOURCE = [];

const rows = SOURCE.map(function (s, i) {
  return {
    title: s.title,
    start_at: s.start_at || null,
    end_at: s.end_at || null,
    event_date: s.event_date || null,
    description: s.description || null,
    members: Array.isArray(s.members) ? s.members : null,
    status: s.status || "scheduled",
    sort_order: typeof s.sort_order === "number" ? s.sort_order : i
  };
});

runImport({
  table: "schedules",
  rows: rows,
  matchKey: function (r) { return (r.title || "") + "|" + (r.event_date || ""); },
  label: "schedules"
}).catch(function (e) { console.error(e); process.exit(1); });
