const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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

function normalizeUsername(usernameRaw) {
  const username = String(usernameRaw || "")
    .trim()
    .toLowerCase();
  if (!username) return null;
  if (username.length < 3 || username.length > 40) return null;
  if (!/^[a-z0-9._-]+$/.test(username)) return null;
  return username;
}

function normalizePassword(passwordRaw) {
  const password = String(passwordRaw || "");
  if (!password) return null;
  if (password.length < 6) return null;
  return password;
}

function toBase64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const issuer = String(process.env.JWT_ISSUER || "t-one-pos").trim() || "t-one-pos";
  const accessTtl = String(process.env.JWT_ACCESS_TTL || "15m").trim() || "15m";
  return { secret, issuer, accessTtl };
}

function signAccessToken(user, sessionId) {
  const cfg = getJwtConfig();
  if (!cfg) throw new Error("JWT_SECRET is missing");

  const payload = {
    sub: String(user.id),
    role: String(user.role),
    sid: sessionId ? Number(sessionId) : undefined,
  };

  return jwt.sign(payload, cfg.secret, {
    expiresIn: cfg.accessTtl,
    issuer: cfg.issuer,
  });
}

async function createSession(userId, { userAgent, ip } = {}) {
  const ttlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30;

  const refreshToken = toBase64Url(crypto.randomBytes(32));
  const refreshHash = sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const result = await query(
    "INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)",
    [userId, refreshHash, expiresAt, userAgent || null, ip || null]
  );

  return {
    sessionId: result.insertId,
    refreshToken,
    expiresAt,
  };
}

async function rotateSession(sessionId, { userAgent, ip } = {}) {
  const ttlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30;

  const refreshToken = toBase64Url(crypto.randomBytes(32));
  const refreshHash = sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await query(
    "UPDATE auth_sessions SET refresh_token_hash = ?, last_used_at = NOW(), expires_at = ?, user_agent = ?, ip = ? WHERE id = ?",
    [refreshHash, expiresAt, userAgent || null, ip || null, sessionId]
  );

  return { refreshToken, expiresAt };
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    canDiscount: Boolean(u.canDiscount),
  };
}

exports.me = async (req, res) => {
  return res.json({ user: publicUser(req.user) });
};

exports.login = async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const rows = await query(
      "SELECT id, name, username, password_hash AS passwordHash, role, can_discount AS canDiscount FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = rows[0];
    if (!user.passwordHash) {
      return res.status(401).json({ error: "Account has no password set. Ask an admin to reset it." });
    }

    const ok = await bcrypt.compare(password, String(user.passwordHash));
    if (!ok) return res.status(401).json({ error: "Invalid username or password" });

    const session = await createSession(user.id, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

    const accessToken = signAccessToken(user, session.sessionId);
    return res.json({
      user: publicUser(user),
      accessToken,
      refreshToken: session.refreshToken,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.refresh = async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });

    const hash = sha256Hex(refreshToken);
    const rows = await query(
      `SELECT 
        s.id AS sessionId,
        s.revoked_at AS revokedAt,
        s.expires_at AS expiresAt,
        u.id AS id,
        u.name,
        u.username,
        u.role,
        u.can_discount AS canDiscount
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ?
      LIMIT 1`,
      [hash]
    );

    if (!rows || rows.length === 0) return res.status(401).json({ error: "Invalid refresh token" });

    const session = rows[0];
    if (session.revokedAt) return res.status(401).json({ error: "Session revoked" });
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({ error: "Session expired" });
    }

    const rotated = await rotateSession(session.sessionId, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

    const accessToken = signAccessToken(session, session.sessionId);
    return res.json({
      user: publicUser(session),
      accessToken,
      refreshToken: rotated.refreshToken,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.logout = async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    if (!refreshToken) return res.json({ success: true });

    const hash = sha256Hex(refreshToken);
    await query("UPDATE auth_sessions SET revoked_at = NOW() WHERE refresh_token_hash = ? AND revoked_at IS NULL", [
      hash,
    ]);

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.bootstrapStatus = async (req, res) => {
  try {
    const allowed = String(process.env.ALLOW_BOOTSTRAP || "").toLowerCase() === "true";
    if (!allowed) return res.json({ enabled: false, reason: "disabled" });

    const existingAdminRows = await query(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND password_hash IS NOT NULL",
      []
    );
    const c = Number(existingAdminRows?.[0]?.c || 0);
    if (c > 0) return res.json({ enabled: false, reason: "admin_exists" });

    return res.json({ enabled: true });
  } catch (err) {
    console.error(err);
    // Fail closed: hide bootstrap UI if we can't verify status.
    return res.json({ enabled: false, reason: "error" });
  }
};

exports.bootstrap = async (req, res) => {
  try {
    if (String(process.env.ALLOW_BOOTSTRAP || "").toLowerCase() !== "true") {
      return res.status(404).json({ error: "Not found" });
    }

    const name = String(req.body?.name || "").trim();
    const username = normalizeUsername(req.body?.username);
    const password = normalizePassword(req.body?.password);

    if (!name) return res.status(400).json({ error: "name is required" });
    if (!username) {
      return res.status(400).json({ error: "username must be 3-40 chars (a-z, 0-9, ., _, -)" });
    }
    if (!password) return res.status(400).json({ error: "password must be at least 6 characters" });

    const existingAdminRows = await query(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND password_hash IS NOT NULL",
      []
    );
    const c = Number(existingAdminRows?.[0]?.c || 0);
    if (c > 0) return res.status(403).json({ error: "Bootstrap disabled: an admin already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      "INSERT INTO users (name, username, password_hash, role, can_discount) VALUES (?, ?, ?, 'admin', 1)",
      [name, username, passwordHash]
    );

    const user = {
      id: result.insertId,
      name,
      username,
      role: "admin",
      canDiscount: 1,
    };

    const session = await createSession(user.id, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

    const accessToken = signAccessToken(user, session.sessionId);
    return res.status(201).json({
      user: publicUser(user),
      accessToken,
      refreshToken: session.refreshToken,
    });
  } catch (err) {
    console.error(err);
    const mysqlDuplicate = err && (err.code === "ER_DUP_ENTRY" || String(err.message || "").includes("Duplicate"));
    if (mysqlDuplicate) {
      return res.status(409).json({ error: "Username already exists" });
    }
    return res.status(500).json({ error: err.message });
  }
};
