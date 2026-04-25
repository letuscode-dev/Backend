const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const readline = require("readline");

const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

function parseArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1) {
    const next = argv[idx + 1];
    if (next && !next.startsWith("--")) return next;
    return "";
  }
  const withEq = argv.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1);
  return null;
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

function isPlaceholderSecret(secretRaw) {
  const s = String(secretRaw || "").trim();
  if (!s) return true;
  const bad = new Set(["dev_secret_change_me", "change_me_in_production", "changeme", "secret"]);
  return bad.has(s.toLowerCase());
}

function randomSecret() {
  // base64url keeps it env-file friendly (no quotes needed).
  return crypto.randomBytes(48).toString("base64url");
}

function detectEol(text) {
  return String(text).includes("\r\n") ? "\r\n" : "\n";
}

function setEnvValue(contentsRaw, key, value) {
  const contents = String(contentsRaw || "");
  const eol = detectEol(contents);
  const line = `${key}=${value}`;

  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  if (re.test(contents)) return contents.replace(re, line);

  const trimmedEnd = contents.replace(/\s+$/g, "");
  const sep = trimmedEnd ? eol + eol : "";
  return trimmedEnd + sep + line + eol;
}

function ensureEnvFile(backendDir) {
  const envPath = path.join(backendDir, ".env");
  const envExample = path.join(backendDir, ".env.example");

  if (fs.existsSync(envPath)) return envPath;
  if (!fs.existsSync(envExample)) {
    console.error("Missing backend/.env.example");
    process.exit(1);
  }

  fs.copyFileSync(envExample, envPath);
  console.log("Created backend/.env from backend/.env.example");
  return envPath;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || ""));
    });
  });
}

async function createAdminIfMissing({ conn, name, username, password }) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND password_hash IS NOT NULL",
    []
  );
  const c = Number(rows?.[0]?.c || 0);
  if (c > 0) return { created: false, reason: "admin_exists" };

  const passwordHash = await bcrypt.hash(password, 12);

  const [result] = await conn.query(
    "INSERT INTO users (name, username, password_hash, role, can_discount) VALUES (?, ?, ?, 'admin', 1)",
    [name, username, passwordHash]
  );

  return { created: true, id: result.insertId };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "T-ONE POS fresh install",
        "",
        "Usage: npm run fresh-install -- [options]",
        "",
        "Options:",
        "  --admin-name <name>",
        "  --admin-username <username>",
        "  --admin-password <password>",
        "  --skip-admin            (only run migrations)",
        "  --no-lock-bootstrap     (do not set ALLOW_BOOTSTRAP=false)",
        "",
        "Env fallbacks: ADMIN_NAME, ADMIN_USERNAME, ADMIN_PASSWORD",
      ].join("\n")
    );
    return;
  }

  const backendDir = path.join(__dirname, "..");
  const envPath = ensureEnvFile(backendDir);
  require("dotenv").config({ path: envPath });

  const skipAdmin = argv.includes("--skip-admin");
  const lockBootstrap = !argv.includes("--no-lock-bootstrap");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  let dbName = String(process.env.DB_NAME || "").trim();
  if (!dbName && databaseUrl) {
    const u = new URL(databaseUrl);
    const fromUrl = String(u.pathname || "").replace(/^\/+/, "");
    if (!fromUrl) {
      console.error("DATABASE_URL must include a database name (e.g. mysql://user:pass@host:3306/db)");
      process.exit(1);
    }
    dbName = fromUrl;
  }
  if (!dbName) {
    console.error("Missing DB_NAME (or DATABASE_URL) in backend/.env");
    process.exit(1);
  }

  // 1) Migrate DB first.
  const migratePath = path.join(__dirname, "migrate.js");
  const migrate = spawnSync(process.execPath, [migratePath], { stdio: "inherit" });
  if (typeof migrate.status === "number" && migrate.status !== 0) process.exit(migrate.status);

  // 2) Create first admin (if needed).
  if (!skipAdmin) {
    const adminName =
      parseArgValue(argv, "--admin-name") ??
      String(process.env.ADMIN_NAME || "").trim() ??
      "";

    const adminUserRaw =
      parseArgValue(argv, "--admin-username") ??
      String(process.env.ADMIN_USERNAME || "").trim() ??
      "";

    const adminPass =
      parseArgValue(argv, "--admin-password") ??
      String(process.env.ADMIN_PASSWORD || "").trim() ??
      "";

    const name = adminName || (await ask("Admin name: ")).trim();
    let username = normalizeUsername(adminUserRaw);
    if (!username) username = normalizeUsername(await ask("Admin username (3-40, a-z0-9._-): "));
    let password = adminPass;
    if (!password) password = await ask("Admin password (min 6 chars): ");

    if (!name) {
      console.error("Admin name is required.");
      process.exit(1);
    }
    if (!username) {
      console.error("Admin username is invalid (3-40 chars, a-z0-9._-).");
      process.exit(1);
    }
    if (!password || String(password).length < 6) {
      console.error("Admin password must be at least 6 characters.");
      process.exit(1);
    }

    const host = String(process.env.DB_HOST || "").trim() || "localhost";
    const user = String(process.env.DB_USER || "").trim() || "root";
    const pwd = process.env.DB_PASSWORD == null ? "" : String(process.env.DB_PASSWORD);
    const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined;

    const conn = databaseUrl
      ? await mysql.createConnection(databaseUrl)
      : await mysql.createConnection({
          host,
          user,
          password: pwd,
          database: dbName,
          port: Number.isFinite(port) && port > 0 ? port : undefined,
        });

    try {
      const result = await createAdminIfMissing({ conn, name, username, password });
      if (result.created) {
        console.log(`Created admin user (id: ${result.id}, username: ${username}).`);
      } else {
        console.log("Admin already exists. Skipping admin creation.");
      }

      // 3) Lock bootstrap + generate a real JWT secret if placeholders are still present.
      if (lockBootstrap) {
        const envContents = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
        let next = envContents;

        // Always disable bootstrap after the first admin exists (or was created).
        next = setEnvValue(next, "ALLOW_BOOTSTRAP", "false");

        const currentSecret = String(process.env.JWT_SECRET || "").trim();
        if (isPlaceholderSecret(currentSecret)) {
          next = setEnvValue(next, "JWT_SECRET", randomSecret());
          console.log("Generated a new JWT_SECRET and wrote it to backend/.env");
        }

        if (next !== envContents) {
          fs.writeFileSync(envPath, next, "utf8");
          console.log("Updated backend/.env (ALLOW_BOOTSTRAP=false).");
        }
      }
    } finally {
      await conn.end();
    }
  }

  console.log("");
  console.log("Fresh install complete.");
  console.log("Next: from the repo root, run `npm run dev`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
