const fs = require("fs");
const path = require("path");

function pad4(n) {
  return String(n).padStart(4, "0");
}

function slugify(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function main() {
  const description = process.argv.slice(2).join(" ").trim();
  if (!description) {
    console.error("Usage: node db/make-migration.js <description>");
    process.exit(1);
  }

  const dir = path.join(__dirname, "migrations");
  fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/i.test(f));
  let max = 0;
  for (const f of files) {
    const n = Number.parseInt(f.slice(0, 4), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  const next = max + 1;
  const slug = slugify(description) || "migration";
  const filename = `${pad4(next)}_${slug}.sql`;
  const fullPath = path.join(dir, filename);

  if (fs.existsSync(fullPath)) {
    console.error("Migration already exists:", filename);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const template =
    `-- ${filename}\n` +
    `-- Created ${now}\n\n` +
    `-- Write your SQL below.\n`;

  fs.writeFileSync(fullPath, template, "utf8");
  console.log("Created migration:", filename);
}

main();

