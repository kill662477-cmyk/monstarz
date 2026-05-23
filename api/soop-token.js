export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const clientId = process.env.SOOP_CLIENT_ID || body.client_id;
    const clientSecret = process.env.SOOP_CLIENT_SECRET;
    const redirectUri = process.env.SOOP_REDIRECT_URI || body.redirect_uri;
    const code = body.code || body.authCode;

    if (!clientId) throw new Error("SOOP_CLIENT_ID 환경변수가 없습니다.");
    if (!clientSecret) throw new Error("SOOP_CLIENT_SECRET 환경변수가 없습니다.");
    if (!redirectUri) throw new Error("SOOP_REDIRECT_URI 또는 redirect_uri가 없습니다.");
    if (!code) throw new Error("code/authCode가 없습니다.");

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    form.set("redirect_uri", redirectUri);
    form.set("code", code);

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
        error: data.error || "soop_token_error",
        message: data.message || data.error_description || raw
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      message: err.message || String(err)
    });
  }
}
