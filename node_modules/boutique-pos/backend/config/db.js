const mysql = require("mysql2");

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseBool(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  return false;
}

function getPoolConfig() {
  const urlRaw = String(process.env.DATABASE_URL || "").trim();
  const connectionLimit = toPositiveInt(process.env.DB_POOL_LIMIT, 10);

  if (urlRaw) {
    const u = new URL(urlRaw);
    const database = String(u.pathname || "").replace(/^\/+/, "");
    if (!database) {
      throw new Error("DATABASE_URL must include a database name (e.g. mysql://user:pass@host:3306/db)");
    }

    const sslParam = String(u.searchParams.get("ssl") || u.searchParams.get("sslmode") || "").toLowerCase();
    const wantsSsl =
      parseBool(process.env.DB_SSL) ||
      parseBool(process.env.MYSQL_SSL) ||
      ["true", "1", "require", "required", "verify_ca", "verify_identity"].includes(sslParam);

    const cfg = {
      host: u.hostname,
      port: u.port ? toPositiveInt(u.port, undefined) : undefined,
      user: u.username || undefined,
      password: u.password || undefined,
      database,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
    };

    if (wantsSsl) {
      // Many managed MySQL providers require TLS. Railway often works via TCP proxy,
      // but this keeps it configurable without hardcoding.
      cfg.ssl = { rejectUnauthorized: false };
    }

    return cfg;
  }

  const port = process.env.DB_PORT ? toPositiveInt(process.env.DB_PORT, undefined) : undefined;
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port,
    waitForConnections: true,
    connectionLimit,
    queueLimit: 0,
  };
}

const pool = mysql.createPool(getPoolConfig());

// Verify DB connectivity once on startup (fail fast).
pool.getConnection((err, conn) => {
  if (err) {
    console.error("MySQL connection failed:", err.message);
    process.exit(1);
  }
  conn.release();
  console.log("MySQL Connected");
});

module.exports = pool;
