const soopRefreshRateBuckets = globalThis.__MONSTARZ_SOOP_REFRESH_BUCKETS || (globalThis.__MONSTARZ_SOOP_REFRESH_BUCKETS = new Map());

function rateLimit(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 30;
  let bucket = soopRefreshRateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    soopRefreshRateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= max) return true;
  res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  res.status(429).json({ error: "rate_limited", code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
  return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!rateLimit(req, res)) return;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const clientId = process.env.SOOP_CLIENT_ID || body.client_id;
    const clientSecret = process.env.SOOP_CLIENT_SECRET;
    const redirectUri = process.env.SOOP_REDIRECT_URI || body.redirect_uri;
    const refreshToken = body.refresh_token || body.refreshToken;

    if (!clientId) throw new Error("SOOP_CLIENT_ID 환경변수가 없습니다.");
    if (!clientSecret) throw new Error("SOOP_CLIENT_SECRET 환경변수가 없습니다.");
    if (!redirectUri) throw new Error("SOOP_REDIRECT_URI 또는 redirect_uri가 없습니다.");
    if (!refreshToken) throw new Error("refresh_token이 없습니다.");

    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    form.set("redirect_uri", redirectUri);
    form.set("refresh_token", refreshToken);

    const soopRes = await fetch("https://openapi.sooplive.com/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*"
      },
      body: form
    });

    const raw = await soopRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!soopRes.ok || data.error) {
      return res.status(soopRes.status || 500).json({
        error: data.error || "soop_refresh_error",
        code: "SOOP_REFRESH_ERROR",
        message: data.message || data.error_description || "SOOP 토큰 갱신에 실패했습니다."
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      code: "SERVER_ERROR",
      message: err.message || "SOOP 토큰 갱신을 처리하지 못했습니다."
    });
  }
}
