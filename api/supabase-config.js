// 공개 Supabase 설정(URL + anon/publishable 키)을 브라우저에 전달합니다.
// 이 값들은 공개되어도 되는 값이며 RLS 로 보호됩니다.
// 환경변수가 없으면 ready:false 를 200 으로 반환해 프론트가 fallback 으로 동작하게 합니다.
const { getPublicConfig } = require("../lib/supabase/server");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const cfg = getPublicConfig();
  return res.status(200).json({ url: cfg.url, anonKey: cfg.anonKey, ready: cfg.ready });
};
