const crypto = require("crypto");
const { getRedisClient } = require("../lib/redisClient");

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sha1Hex(text) {
  return crypto.createHash("sha1").update(String(text), "utf8").digest("hex");
}

function getPrefix() {
  const prefix = String(process.env.REDIS_PREFIX || "tonepos").trim() || "tonepos";
  return prefix;
}

// Atomic counter + TTL (window) using Lua.
// Returns {count, ttlMs}
const LUA_INCR_TTL = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

function createRedisRateLimiter({
  name = "rl",
  windowMs = 15 * 60 * 1000,
  max = 60,
  keyFn,
  fallback,
  message = "Too many requests. Please wait and try again.",
} = {}) {
  const maxHits = toPositiveInt(max, 60);
  const winMs = toPositiveInt(windowMs, 15 * 60 * 1000);
  const prefix = getPrefix();
  const safeName = String(name || "rl").trim() || "rl";

  return async (req, res, next) => {
    const now = Date.now();
    const keyRaw = typeof keyFn === "function" ? keyFn(req) : req.ip;
    const keyBase = keyRaw == null ? "" : String(keyRaw).trim();
    if (!keyBase) return next();

    // Hash the key to keep Redis keys short and avoid leaking identifiers.
    const keyHash = sha1Hex(keyBase);
    const redisKey = `${prefix}:ratelimit:${safeName}:${keyHash}`;

    let client;
    try {
      client = await getRedisClient();
    } catch (err) {
      // If Redis is down, fall back (auth endpoints still work).
      if (typeof fallback === "function") return fallback(req, res, next);
      return next();
    }

    if (!client) {
      if (typeof fallback === "function") return fallback(req, res, next);
      return next();
    }

    let reply;
    try {
      reply = await client.eval(LUA_INCR_TTL, {
        keys: [redisKey],
        arguments: [String(winMs)],
      });
    } catch (err) {
      if (typeof fallback === "function") return fallback(req, res, next);
      return next();
    }

    const count = Array.isArray(reply) ? Number(reply[0]) : Number(reply);
    const ttlMs = Array.isArray(reply) ? Number(reply[1]) : winMs;

    const remaining = Math.max(0, maxHits - (Number.isFinite(count) ? count : 0));
    const resetInSec = Math.max(1, Math.ceil((Math.max(0, Number.isFinite(ttlMs) ? ttlMs : winMs)) / 1000));

    res.setHeader("RateLimit-Limit", String(maxHits));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetInSec));

    if (Number.isFinite(count) && count > maxHits) {
      res.setHeader("Retry-After", String(resetInSec));
      return res.status(429).json({ error: message });
    }

    // Opportunistically touch keys to avoid "stuck" no-ttl keys if TTL was lost.
    // Not strictly needed; the Lua script sets TTL on first hit.
    if (Number.isFinite(ttlMs) && ttlMs < 0) {
      try {
        await client.pexpire(redisKey, winMs);
      } catch {
        // ignore
      }
    }

    return next();
  };
}

module.exports = { createRedisRateLimiter };
