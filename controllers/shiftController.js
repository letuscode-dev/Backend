const db = require("../config/db");
const { HttpError, query, queryConn, withTransaction } = require("../lib/dbTx");

function parseId(idRaw) {
  const id = Number.parseInt(String(idRaw), 10);
  return Number.isFinite(id) ? id : null;
}

function parseNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

exports.getOpenShift = async (req, res) => {
  try {
    const cashierId = Number(req.user?.id);

    const rows = await query(
      db,
      `SELECT
        sh.id,
        sh.cashier_id AS cashierId,
        sh.opened_at AS openedAt,
        sh.closed_at AS closedAt,
        sh.opening_float AS openingFloat,
        sh.closing_cash AS closingCash,
        sh.sales_total AS salesTotal,
        sh.expected_cash AS expectedCash,
        sh.variance
      FROM shifts sh
      WHERE sh.cashier_id = ? AND sh.closed_at IS NULL
      ORDER BY sh.opened_at DESC
      LIMIT 1`,
      [cashierId]
    );

    if (!rows || rows.length === 0) return res.json(null);

    const shift = rows[0];

    // Compute current sales total so far for this shift window (cashier-based).
    const salesRows = await query(
      db,
      "SELECT COALESCE(SUM(total), 0) AS salesTotal FROM sales WHERE cashier_id = ? AND created_at >= ? AND created_at <= NOW()",
      [cashierId, shift.openedAt]
    );

    const salesTotal = Number(salesRows?.[0]?.salesTotal || 0);
    const openingFloat = Number(shift.openingFloat || 0);
    const expectedCash = toMoney(openingFloat + salesTotal);

    return res.json({
      ...shift,
      salesTotal: salesTotal,
      expectedCash,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.openShift = async (req, res) => {
  try {
    const cashierId = Number(req.user?.id);
    const openingFloatRaw = req.body?.openingFloat;
    const openingFloat = openingFloatRaw == null || openingFloatRaw === "" ? 0 : parseNumber(openingFloatRaw);

    if (openingFloat == null || openingFloat < 0) {
      return res.status(400).json({ error: "openingFloat must be a valid number >= 0" });
    }

    const existing = await query(
      db,
      "SELECT id FROM shifts WHERE cashier_id = ? AND closed_at IS NULL LIMIT 1",
      [cashierId]
    );
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: "This cashier already has an open shift" });
    }

    const result = await query(
      db,
      "INSERT INTO shifts (cashier_id, opening_float, sales_total, expected_cash) VALUES (?, ?, 0, ?)",
      [cashierId, toMoney(openingFloat), toMoney(openingFloat)]
    );

    return res.status(201).json({
      id: result.insertId,
      cashierId,
      openedAt: new Date().toISOString(),
      closedAt: null,
      openingFloat: toMoney(openingFloat),
      closingCash: null,
      salesTotal: 0,
      expectedCash: toMoney(openingFloat),
      variance: null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.closeShift = async (req, res) => {
  try {
    const shiftId = parseId(req.params.id);
    if (shiftId == null) return res.status(400).json({ error: "Invalid shift id" });

    const closingCashRaw = req.body?.closingCash;
    const closingCash = parseNumber(closingCashRaw);
    if (closingCash == null || closingCash < 0) {
      return res.status(400).json({ error: "closingCash must be a valid number >= 0" });
    }

    const actor = req.user;

    const txResult = await withTransaction(db, async (conn) => {
      const shiftRows = await queryConn(
        conn,
        "SELECT id, cashier_id AS cashierId, opened_at AS openedAt, closed_at AS closedAt, opening_float AS openingFloat FROM shifts WHERE id = ? FOR UPDATE",
        [shiftId]
      );
      if (!shiftRows || shiftRows.length === 0) throw new HttpError(404, "Shift not found");

      const shift = shiftRows[0];
      if (shift.closedAt) throw new HttpError(400, "Shift is already closed");

      const cashierId = Number(shift.cashierId);
      const actorIsAdmin = String(actor.role) === "admin";
      if (!actorIsAdmin && Number(actor.id) !== cashierId) {
        throw new HttpError(403, "Only this cashier (or an admin) can close the shift");
      }

      const salesRows = await queryConn(
        conn,
        "SELECT COALESCE(SUM(total), 0) AS salesTotal FROM sales WHERE cashier_id = ? AND created_at >= ? AND created_at <= NOW()",
        [cashierId, shift.openedAt]
      );
      const salesTotal = Number(salesRows?.[0]?.salesTotal || 0);

      const openingFloat = Number(shift.openingFloat || 0);
      const expectedCash = toMoney(openingFloat + salesTotal);
      const variance = toMoney(toMoney(closingCash) - expectedCash);

      await queryConn(
        conn,
        "UPDATE shifts SET closed_at = NOW(), closing_cash = ?, sales_total = ?, expected_cash = ?, variance = ? WHERE id = ?",
        [toMoney(closingCash), toMoney(salesTotal), expectedCash, variance, shiftId]
      );

      const closedRows = await queryConn(conn, "SELECT closed_at AS closedAt FROM shifts WHERE id = ?", [shiftId]);
      const closedAt = closedRows?.[0]?.closedAt || null;

      return {
        cashierId,
        openedAt: shift.openedAt,
        closedAt,
        openingFloat,
        salesTotal,
        expectedCash,
        variance,
      };
    });

    return res.json({
      id: shiftId,
      cashierId: txResult.cashierId,
      openedAt: txResult.openedAt,
      closedAt: txResult.closedAt || new Date().toISOString(),
      openingFloat: toMoney(txResult.openingFloat),
      closingCash: toMoney(closingCash),
      salesTotal: toMoney(txResult.salesTotal),
      expectedCash: txResult.expectedCash,
      variance: txResult.variance,
    });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.listShifts = async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from).trim() : null;
    const to = req.query.to ? String(req.query.to).trim() : null;

    const where = [];
    const params = [];
    if (from) {
      where.push("sh.opened_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("sh.opened_at <= ?");
      params.push(to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      db,
      `SELECT
        sh.id,
        sh.cashier_id AS cashierId,
        u.name AS cashierName,
        sh.opened_at AS openedAt,
        sh.closed_at AS closedAt,
        sh.opening_float AS openingFloat,
        sh.closing_cash AS closingCash,
        sh.sales_total AS salesTotal,
        sh.expected_cash AS expectedCash,
        sh.variance
      FROM shifts sh
      LEFT JOIN users u ON u.id = sh.cashier_id
      ${whereSql}
      ORDER BY sh.id DESC
      LIMIT 200`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
