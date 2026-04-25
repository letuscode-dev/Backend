const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function escapeId(name) {
  // Basic identifier escaping for CREATE DATABASE.
  return `\`${String(name || "").replace(/`/g, "``")}\``;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function stripComments(sql) {
  // Remove /* ... */ blocks (best-effort).
  const noBlock = String(sql || "").replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove full-line comments (-- and #).
  return noBlock
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t.startsWith("--")) return false;
      if (t.startsWith("#")) return false;
      return true;
    })
    .join("\n");
}

function splitSqlStatements(sqlRaw) {
  const sql = String(sqlRaw || "");
  const out = [];
  let buf = "";

  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle) {
        // SQL escapes single quotes by doubling them: ''.
        if (sql[i + 1] === "'") {
          buf += "''";
          i += 1;
          continue;
        }
        inSingle = false;
        buf += ch;
        continue;
      }
      inSingle = true;
      buf += ch;
      continue;
    }

    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }

    if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      buf += ch;
      continue;
    }

    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      continue;
    }

    buf += ch;
  }

  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

function isIgnorableMigrationError(err) {
  const code = String(err?.code || "");
  // Common "already exists" errors when patching older DBs.
  if (code === "ER_DUP_FIELDNAME") return true; // Duplicate column name
  if (code === "ER_DUP_KEYNAME") return true; // Duplicate key name
  if (code === "ER_TABLE_EXISTS_ERROR") return true;
  return false;
}

async function ensureDatabase({ host, user, password, port, dbName }) {
  const admin = await mysql.createConnection({
    host,
    user,
    password,
    port,
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${escapeId(dbName)}`);
  } finally {
    await admin.end();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const statusOnly = args.has("--status");
  const dryRun = args.has("--dry-run") || args.has("--dry");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const host = String(process.env.DB_HOST || "").trim() || "localhost";
  const user = String(process.env.DB_USER || "").trim() || "root";
  const password = process.env.DB_PASSWORD == null ? "" : String(process.env.DB_PASSWORD);
  const port = process.env.DB_PORT ? toPositiveInt(process.env.DB_PORT, undefined) : undefined;

  let dbName = String(process.env.DB_NAME || "").trim();
  let urlInfo = null;
  if (databaseUrl) {
    const u = new URL(databaseUrl);
    const fromUrl = String(u.pathname || "").replace(/^\/+/, "");
    if (!fromUrl) {
      console.error("DATABASE_URL must include a database name (e.g. mysql://user:pass@host:3306/db)");
      process.exit(1);
    }
    dbName = fromUrl;
    urlInfo = { host: u.hostname, port: u.port || "", dbName };
  }

  if (!dbName) {
    console.error("Missing DB_NAME (or DATABASE_URL) in backend/.env");
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.log("No migrations directory found:", migrationsDir);
    return;
  }

  let conn;
  if (databaseUrl) {
    // In managed DBs (Railway), the database already exists; connect directly.
    conn = await mysql.createConnection(databaseUrl);
  } else {
    await ensureDatabase({ host, user, password, port, dbName });
    conn = await mysql.createConnection({
      host,
      user,
      password,
      database: dbName,
      port,
    });
  }

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_schema_migrations_filename (filename)
      ) ENGINE=InnoDB`
    );

    const [appliedRows] = await conn.query("SELECT filename, checksum, applied_at AS appliedAt FROM schema_migrations");
    const applied = new Map();
    for (const r of appliedRows || []) {
      applied.set(String(r.filename), { checksum: String(r.checksum), appliedAt: r.appliedAt });
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.toLowerCase().endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    const plan = files.map((filename) => {
      const fullPath = path.join(migrationsDir, filename);
      const raw = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
      const checksum = sha256Hex(raw);
      const record = applied.get(filename);
      return {
        filename,
        fullPath,
        checksum,
        applied: Boolean(record),
        appliedAt: record?.appliedAt || null,
        checksumMatches: record ? record.checksum === checksum : null,
        sql: raw,
      };
    });

    // Fail fast if an applied migration file was modified.
    const modified = plan.find((m) => m.applied && m.checksumMatches === false);
    if (modified) {
      console.error(
        `Migration file was modified after being applied: ${modified.filename}. ` +
          `Create a new migration instead of editing applied files.`
      );
      process.exit(1);
    }

    const pending = plan.filter((m) => !m.applied);

    if (statusOnly || dryRun) {
      if (urlInfo) {
        const hostLabel = urlInfo.port ? `${urlInfo.host}:${urlInfo.port}` : urlInfo.host;
        console.log(`DB: ${dbName} @ ${hostLabel}`);
      } else {
        console.log(`DB: ${dbName}`);
      }
      console.log(`Applied: ${plan.length - pending.length}`);
      console.log(`Pending: ${pending.length}`);
      for (const m of pending) console.log(`- ${m.filename}`);
      return;
    }

    for (const m of pending) {
      console.log(`Applying ${m.filename}...`);
      const cleaned = stripComments(m.sql);
      const statements = splitSqlStatements(cleaned);

      for (const stmt of statements) {
        try {
          await conn.query(stmt);
        } catch (err) {
          if (isIgnorableMigrationError(err)) {
            console.log(`  [skip] ${err.code}: ${err.message}`);
            continue;
          }
          console.error(`  [fail] ${err.code || ""} ${err.message || err}`);
          throw err;
        }
      }

      await conn.query("INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)", [m.filename, m.checksum]);
      console.log(`Applied ${m.filename}`);
    }

    console.log("Migrations complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
