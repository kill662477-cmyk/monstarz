// 전적 원본 조회 API: Storage 의 records/<key>.json.gz 를 service key로 받아
// 압축 해제한 JSON 만 브라우저에 돌려줍니다. (service key 는 절대 노출되지 않음)
// GET /api/tier-records?key=<userId>_<race>
const { downloadGzJson, DEFAULT_BUCKET } = require("../lib/supabase/storage");

function safeKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const key = safeKey(req.query && req.query.key);
  if (!key) return res.status(400).json({ error: "missing_key" });

  try {
    const data = await downloadGzJson(DEFAULT_BUCKET, "records/" + key + ".json.gz");
    if (data === null) {
      res.setHeader("Cache-Control", "s-maxage=30");
      return res.status(404).json({ key: key, data: null, isEmpty: true, error: "not_found" });
    }
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json({ key: key, data: data, isEmpty: Array.isArray(data) ? data.length === 0 : !data });
  } catch (e) {
    if (e && e.code === "supabase_not_configured") {
      return res.status(503).json({ error: "supabase_not_configured", key: key, data: null, isEmpty: true });
    }
    return res.status(500).json({ error: "tier_records_error", message: (e && e.message) || "error", key: key, data: null, isEmpty: true });
  }
};
