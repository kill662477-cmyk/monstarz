// Public-safe Supabase overrides for auto-collected notices/videos.
// Uses the server-only service key, but returns only metadata needed by the public UI.
const admin = require("../lib/supabase/admin");

function publicNoticeMeta(row) {
  return {
    source_key: row.source_key || "",
    title: row.title || "",
    station_name: row.station_name || "",
    link: row.link || "",
    notice_date: row.notice_date || "",
    is_pinned: row.is_pinned === true,
    sort_order: Number(row.sort_order || 0),
    is_visible: row.is_visible !== false,
    updated_at: row.updated_at || ""
  };
}

function publicVideoMeta(row) {
  const visible = row.is_visible !== false;
  if (!visible) {
    return {
      url: row.url || "",
      is_visible: false,
      is_pinned: false,
      sort_order: Number(row.sort_order || 0),
      updated_at: row.updated_at || ""
    };
  }

  return {
    title: row.title || "",
    platform: row.platform || "",
    member_code: row.member_code || "",
    url: row.url || "",
    published_at: row.published_at || "",
    thumbnail: row.thumbnail || "",
    is_pinned: row.is_pinned === true,
    sort_order: Number(row.sort_order || 0),
    is_visible: true,
    updated_at: row.updated_at || ""
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const [noticesMeta, videos] = await Promise.all([
      admin.rest("GET", "notices_meta", {
        query: "?select=source_key,title,station_name,link,notice_date,is_pinned,sort_order,is_visible,updated_at&order=sort_order.asc"
      }),
      admin.rest("GET", "videos", {
        query: "?select=title,platform,member_code,url,published_at,thumbnail,is_pinned,sort_order,is_visible,updated_at&order=sort_order.asc"
      })
    ]);

    return res.status(200).json({
      ok: true,
      ready: true,
      noticesMeta: Array.isArray(noticesMeta) ? noticesMeta.map(publicNoticeMeta) : [],
      videos: Array.isArray(videos) ? videos.map(publicVideoMeta) : []
    });
  } catch (error) {
    if (error && error.code === "supabase_not_configured") {
      return res.status(200).json({ ok: true, ready: false, noticesMeta: [], videos: [] });
    }
    console.warn("[public-overrides] unavailable:", error && error.message);
    return res.status(200).json({ ok: true, ready: false, error: "overrides_unavailable", noticesMeta: [], videos: [] });
  }
};
