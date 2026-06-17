// 영상 -> videos 로 import. 원격 YouTube JSON 을 읽어 가져옵니다.
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-videos.js --dry-run
//   ... --apply
const { runImport } = require("./_supabase-import-core");

const YOUTUBE_JSON_URL = "https://raw.githubusercontent.com/kill662477-cmyk/youtube/refs/heads/main/youtube.json";

async function main() {
  let source = [];
  try {
    const res = await fetch(YOUTUBE_JSON_URL, { cache: "no-store" });
    const data = await res.json();
    source = Array.isArray(data) ? data : (data && data.items) || [];
  } catch (e) {
    console.error("원격 YouTube JSON 을 불러오지 못했습니다:", e.message);
  }

  const rows = source.map(function (v, i) {
    return {
      title: String(v.title || "영상"),
      platform: "YouTube",
      url: String(v.url || v.link || (v.videoId ? "https://youtu.be/" + v.videoId : "")),
      published_at: v.publishedAt || v.published || null,
      thumbnail: v.thumbnail || v.thumbnailUrl || null,
      sort_order: i
    };
  }).filter(function (r) { return r.url; });

  await runImport({
    table: "videos",
    rows: rows,
    matchKey: function (r) { return r.url; },
    label: "videos"
  });
}

main().catch(function (e) { console.error(e); process.exit(1); });
