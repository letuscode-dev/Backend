const jwt = require("jsonwebtoken");
const db = require("../config/db");

function query(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const issuer = String(process.env.JWT_ISSUER || "t-one-pos").trim() || "t-one-pos";
  return { secret, issuer };
}

function getBearerToken(req) {
  const header = req.headers?.authorization || "";
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return trimmed.slice(7).trim() || null;
}

async function loadUserById(id) {
  const rows = await query(
    "SELECT id, name, username, role, can_discount AS canDiscount FROM users WHERE id = ?",
    [id]
  );
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

async function loadSessionById(sessionId, userId) {
  const rows = await query(
    "SELECT id, revoked_at AS revokedAt, expires_at AS expiresAt FROM auth_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [sessionId, userId]
  );
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

exports.requireAuth = async (req, res, next) => {
  const cfg = getJwtConfig();
  if (!cfg) {
    return res.status(500).json({ error: "Server misconfigured: JWT_SECRET is missing" });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization: Bearer token" });
  }

  let payload;
  try {
    payload = jwt.verify(token, cfg.secret, { issuer: cfg.issuer });
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const userId = Number(payload?.sub);
  if (!Number.isFinite(userId)) {
    return res.status(401).json({ error: "Invalid token subject" });
  }

  try {
    const sessionId = Number(payload?.sid);
    if (!Number.isFinite(sessionId)) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const session = await loadSessionById(sessionId, userId);
    if (!session) return res.status(401).json({ error: "Session expired" });
    if (session.revokedAt) return res.status(401).json({ error: "Session revoked" });

    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({ error: "Session expired" });
    }

    const user = await loadUserById(userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    req.sessionId = sessionId;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load user" });
  }
};

exports.requireAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin") return res.status(403).json({ error: "Admin access required" });
  return next();
};
