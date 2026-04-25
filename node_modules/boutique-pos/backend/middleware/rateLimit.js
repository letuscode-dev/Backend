function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 60,
  keyFn,
  message = "Too many requests. Please wait and try again.",
} = {}) {
  const maxHits = toPositiveInt(max, 60);
  const winMs = toPositiveInt(windowMs, 15 * 60 * 1000);

  // key -> { count, resetAt }
  const hits = new Map();
  let lastCleanupAt = Date.now();

  function cleanup(now) {
    // Cheap opportunistic cleanup to avoid unbounded growth.
    if (now - lastCleanupAt < winMs * 2) return;
    lastCleanupAt = now;
    for (const [k, v] of hits.entries()) {
      if (!v || !v.resetAt || v.resetAt <= now) hits.delete(k);
    }
  }

  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);

    const keyRaw = typeof keyFn === "function" ? keyFn(req) : req.ip;
    const key = keyRaw == null ? "" : String(keyRaw).trim();
    if (!key) return next();

    const existing = hits.get(key);
    const rec =
      !existing || !existing.resetAt || existing.resetAt <= now
        ? { count: 0, resetAt: now + winMs }
        : existing;

    rec.count += 1;
    hits.set(key, rec);

    const remaining = Math.max(0, maxHits - rec.count);
    const resetInSec = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));

    // RFC-ish headers (best-effort; clients can ignore).
    res.setHeader("RateLimit-Limit", String(maxHits));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetInSec));

    if (rec.count > maxHits) {
      res.setHeader("Retry-After", String(resetInSec));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

module.exports = { createRateLimiter };

