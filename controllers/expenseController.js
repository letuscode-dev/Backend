const db = require("../config/db");
const { HttpError, query, withTransaction } = require("../lib/dbTx");

function normalizeMySqlDateTime(raw, kind) {
  const s = String(raw || "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return kind === "to" ? `${s} 23:59:59` : `${s} 00:00:00`;
  }

  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  return `${m[1]} ${m[2]}:${m[3]}:${m[4] || "00"}`;
}

function toMySqlDateTime(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parsePositiveMoney(raw) {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

function parseLimit(raw, fallback = 50) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.min(500, value));
}

function normalizeText(raw, { max = 255, required = false } = {}) {
  const value = String(raw || "").trim();
  if (!value) return required ? null : "";
  if (value.length > max) return null;
  return value;
}

async function loadExpenseById(id) {
  const rows = await query(
    db,
    `SELECT
      e.id,
      e.user_id AS userId,
      u.name AS userName,
      u.username,
      e.amount,
      e.category,
      e.description,
      e.spent_at AS spentAt,
      e.created_at AS createdAt
    FROM expenses e
    JOIN users u ON u.id = e.user_id
    WHERE e.id = ?
    LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

exports.createExpense = async (req, res) => {
  try {
    const amount = parsePositiveMoney(req.body?.amount);
    const category = normalizeText(req.body?.category, { max: 120 });
    const description = normalizeText(req.body?.description, { max: 255, required: true });
    const spentAtRaw = req.body?.spentAt;
    const spentAt = spentAtRaw == null || spentAtRaw === "" ? null : toMySqlDateTime(spentAtRaw);

    if (amount == null) return res.status(400).json({ error: "Amount must be greater than 0." });
    if (description == null) return res.status(400).json({ error: "Description is required (max 255 characters)." });
    if (category == null) return res.status(400).json({ error: "Category must be 120 characters or fewer." });
    if (spentAtRaw != null && spentAt == null) return res.status(400).json({ error: "spentAt must be a valid date-time." });

    const result = await withTransaction(db, async (conn) => {
      return new Promise((resolve, reject) => {
        const sql = spentAt
          ? "INSERT INTO expenses (user_id, amount, category, description, spent_at) VALUES (?, ?, ?, ?, ?)"
          : "INSERT INTO expenses (user_id, amount, category, description) VALUES (?, ?, ?, ?)";
        const params = spentAt
          ? [req.user.id, amount, category || null, description, spentAt]
          : [req.user.id, amount, category || null, description];

        conn.query(sql, params, (err, insertRes) => {
          if (err) return reject(err);
          resolve(insertRes);
        });
      });
    });

    const expense = await loadExpenseById(result.insertId);
    return res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const viewer = req.user;
    const isAdmin = String(viewer?.role || "").toLowerCase() === "admin";
    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const from = fromRaw != null ? normalizeMySqlDateTime(fromRaw, "from") : null;
    const to = toRaw != null ? normalizeMySqlDateTime(toRaw, "to") : null;
    const limit = parseLimit(req.query.limit, 50);

    if (fromRaw != null && !from) {
      return res.status(400).json({ error: "Invalid from. Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]." });
    }
    if (toRaw != null && !to) {
      return res.status(400).json({ error: "Invalid to. Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]." });
    }
    if (from && to && from > to) return res.status(400).json({ error: "from must be <= to." });
    if (limit == null) return res.status(400).json({ error: "limit must be a positive integer." });

    const where = [];
    const params = [];

    if (!isAdmin) {
      where.push("e.user_id = ?");
      params.push(viewer.id);
    }
    if (from) {
      where.push("e.spent_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("e.spent_at <= ?");
      params.push(to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query(
      db,
      `SELECT
        e.id,
        e.user_id AS userId,
        u.name AS userName,
        u.username,
        e.amount,
        e.category,
        e.description,
        e.spent_at AS spentAt,
        e.created_at AS createdAt
      FROM expenses e
      JOIN users u ON u.id = e.user_id
      ${whereSql}
      ORDER BY e.spent_at DESC, e.id DESC
      LIMIT ${limit}`,
      params
    );

    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
