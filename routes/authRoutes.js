const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const rateLimitStore = String(process.env.RATE_LIMIT_STORE || "")
  .trim()
  .toLowerCase();
const wantsRedisRateLimit = rateLimitStore === "redis" || (!rateLimitStore && !!process.env.REDIS_URL);
let createRedisRateLimiter = null;

if (wantsRedisRateLimit) {
  try {
    ({ createRedisRateLimiter } = require("../middleware/rateLimitRedis"));
  } catch (err) {
    console.error("Redis rate limiter unavailable, falling back to memory:", err?.message || err);
    createRedisRateLimiter = null;
  }
}

function makeLimiter(name, opts) {
  const memory = createRateLimiter(opts);
  if (wantsRedisRateLimit && createRedisRateLimiter) return createRedisRateLimiter({ name, ...opts, fallback: memory });
  return memory;
}

const loginWindowMs = toPositiveInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000);
const loginMaxIp = toPositiveInt(process.env.RATE_LIMIT_LOGIN_MAX_IP, 50);
const loginMaxUser = toPositiveInt(process.env.RATE_LIMIT_LOGIN_MAX_USER, 10);

const refreshWindowMs = toPositiveInt(process.env.RATE_LIMIT_REFRESH_WINDOW_MS, 15 * 60 * 1000);
const refreshMaxIp = toPositiveInt(process.env.RATE_LIMIT_REFRESH_MAX_IP, 120);

const loginByIp = makeLimiter("auth_login_ip", {
  windowMs: loginWindowMs,
  max: loginMaxIp,
  keyFn: (req) => `ip:${req.ip}`,
  message: "Too many login attempts. Please wait and try again.",
});

const loginByUser = makeLimiter("auth_login_user", {
  windowMs: loginWindowMs,
  max: loginMaxUser,
  keyFn: (req) => {
    const u = String(req.body?.username || "")
      .trim()
      .toLowerCase();
    if (!u) return null;
    return `user:${u}`;
  },
  message: "Too many login attempts. Please wait and try again.",
});

const refreshByIp = makeLimiter("auth_refresh_ip", {
  windowMs: refreshWindowMs,
  max: refreshMaxIp,
  keyFn: (req) => `ip:${req.ip}`,
  message: "Too many refresh attempts. Please wait and try again.",
});

router.post("/login", loginByIp, loginByUser, authController.login);
router.post("/refresh", refreshByIp, authController.refresh);
router.post("/logout", authController.logout);
router.get("/bootstrap/status", authController.bootstrapStatus);
router.post("/bootstrap", authController.bootstrap);
router.get("/me", requireAuth, authController.me);

module.exports = router;
