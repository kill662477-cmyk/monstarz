const buckets = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || "";
  const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded).split(",")[0];
  return (first || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown").trim();
}

function cleanup(now) {
  if (buckets.size < 1000) return;
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}

function checkRateLimit(req, res, options) {
  const opts = options || {};
  const now = Date.now();
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max || 60;
  const key = [opts.name || "default", clientIp(req)].join(":");
  cleanup(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count <= max) return true;

  res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  res.status(429).json({
    ok: false,
    error: "rate_limited",
    code: "RATE_LIMITED",
    message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
  });
  return false;
}

module.exports = { checkRateLimit, clientIp };
