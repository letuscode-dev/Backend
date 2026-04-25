const db = require("../config/db");
const { HttpError, query, queryConn, withTransaction } = require("../lib/dbTx");

function parseId(idRaw) {
  const id = Number.parseInt(String(idRaw), 10);
  return Number.isFinite(id) ? id : null;
}

function parseQty(qtyRaw) {
  const qty = Number.parseInt(String(qtyRaw), 10);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

function parseNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMySqlDateTime(raw, kind) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // Date-only: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return kind === "to" ? `${s} 23:59:59` : `${s} 00:00:00`;
  }

  // Datetime (space or T separator): YYYY-MM-DD[ T]HH:MM[:SS]
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const date = m[1];
  const hh = m[2];
  const mm = m[3];
  const ss = m[4] ? m[4] : "00";
  return `${date} ${hh}:${mm}:${ss}`;
}

function toMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

async function recomputeShiftTotalsForCashierAtTime(conn, cashierId, atTime) {
  if (cashierId == null || !Number.isFinite(Number(cashierId))) return null;
  if (!atTime) return null;

  const shiftRows = await queryConn(
    conn,
    `SELECT
      id,
      opened_at AS openedAt,
      closed_at AS closedAt,
      opening_float AS openingFloat,
      closing_cash AS closingCash
    FROM shifts
    WHERE cashier_id = ? AND opened_at <= ? AND (closed_at IS NULL OR closed_at >= ?)
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE`,
    [cashierId, atTime, atTime]
  );

  if (!shiftRows || shiftRows.length === 0) return null;
  const shift = shiftRows[0];

  let salesTotalRows;
  if (shift.closedAt) {
    salesTotalRows = await queryConn(
      conn,
      "SELECT COALESCE(SUM(total), 0) AS salesTotal FROM sales WHERE cashier_id = ? AND created_at >= ? AND created_at <= ?",
      [cashierId, shift.openedAt, shift.closedAt]
    );
  } else {
    salesTotalRows = await queryConn(
      conn,
      "SELECT COALESCE(SUM(total), 0) AS salesTotal FROM sales WHERE cashier_id = ? AND created_at >= ? AND created_at <= NOW()",
      [cashierId, shift.openedAt]
    );
  }

  const salesTotal = Number(salesTotalRows?.[0]?.salesTotal || 0);
  const openingFloat = Number(shift.openingFloat || 0);
  const expectedCash = toMoney(openingFloat + salesTotal);
  const closingCash = shift.closingCash == null ? null : Number(shift.closingCash || 0);
  const variance = shift.closedAt && closingCash != null ? toMoney(toMoney(closingCash) - expectedCash) : null;

  await queryConn(conn, "UPDATE shifts SET sales_total = ?, expected_cash = ?, variance = ? WHERE id = ?", [
    toMoney(salesTotal),
    expectedCash,
    variance,
    shift.id,
  ]);

  return {
    shiftId: shift.id,
    salesTotal: toMoney(salesTotal),
    expectedCash,
    variance,
  };
}

exports.getSales = async (req, res) => {
  try {
    const viewer = req.user;
    const viewerIsAdmin = String(viewer?.role) === "admin";

    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const from = fromRaw != null ? normalizeMySqlDateTime(fromRaw, "from") : null;
    const to = toRaw != null ? normalizeMySqlDateTime(toRaw, "to") : null;
    if (fromRaw != null && !from) {
      return res
        .status(400)
        .json({ error: "Invalid from. Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]" });
    }
    if (toRaw != null && !to) {
      return res
        .status(400)
        .json({ error: "Invalid to. Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]" });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const limitRaw = req.query.limit;
    let limit = 200;
    if (limitRaw != null && String(limitRaw).trim() !== "") {
      const n = Number.parseInt(String(limitRaw), 10);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "limit must be a positive integer" });
      limit = n;
    }
    limit = Math.max(1, Math.min(2000, limit));

    const where = [];
    const params = [];
    if (!viewerIsAdmin) {
      where.push("s.cashier_id = ?");
      params.push(viewer.id);
    }
    if (from) {
      where.push("s.created_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("s.created_at <= ?");
      params.push(to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      db,
      `SELECT 
        s.id,
        s.customer_name AS customerName,
        s.subtotal,
        s.total,
        s.created_at AS createdAt,
        u.id AS cashierId,
        u.name AS cashierName,
        COALESCE(si.itemsCount, 0) AS itemsCount
      FROM sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN (
        SELECT sale_id, COUNT(*) AS itemsCount
        FROM sale_items
        GROUP BY sale_id
      ) si ON si.sale_id = s.id
      ${whereSql}
      ORDER BY s.id DESC
      LIMIT ${limit}`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid sale id" });

    const viewer = req.user;
    const viewerIsAdmin = String(viewer?.role) === "admin";

    const saleRows = await query(
      db,
      `SELECT 
        s.id,
        s.customer_name AS customerName,
        s.subtotal,
        s.total,
        s.created_at AS createdAt,
        u.id AS cashierId,
        u.name AS cashierName
      FROM sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?`,
      [id]
    );

    if (!saleRows || saleRows.length === 0) {
      return res.status(404).json({ error: "Sale not found" });
    }

    if (!viewerIsAdmin && Number(saleRows[0].cashierId) !== Number(viewer.id)) {
      return res.status(403).json({ error: "You can only view your own sales" });
    }

    const items = await query(
      db,
      `SELECT 
        product_id AS productId,
        product_name AS name,
        qty,
        unit_price AS unitPrice,
        unit_cost AS unitCost,
        line_total AS lineTotal
      FROM sale_items
      WHERE sale_id = ?
      ORDER BY id ASC`,
      [id]
    );

    return res.json({ ...saleRows[0], items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.createSale = async (req, res) => {
  const rawItems = req.body?.items;
  const customerName = String(req.body?.customerName || "").trim() || null;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: "Sale items are required" });
  }

  const itemsRequest = rawItems
    .map((it) => ({
      productId: parseId(it?.productId),
      qty: parseQty(it?.qty),
      unitPrice: it?.unitPrice == null ? null : parseNumber(it.unitPrice),
    }))
    .filter((it) => it.productId != null && it.qty != null);

  if (itemsRequest.length === 0) {
    return res.status(400).json({ error: "Valid sale items are required" });
  }

  try {
    const cashier = req.user;
    const canDiscount = String(cashier.role) === "admin" || Boolean(cashier.canDiscount);

    const txResult = await withTransaction(db, async (conn) => {
      // Lock products in a consistent order to reduce deadlock risk under concurrent checkouts.
      const lockOrder = itemsRequest
        .map((it, idx) => ({ ...it, idx }))
        .sort((a, b) => Number(a.productId) - Number(b.productId));

      const computedItems = [];
      let subtotal = 0;

      for (const it of lockOrder) {
        const rows = await queryConn(
          conn,
          "SELECT id, name, price, cost_price AS costPrice, stock FROM products WHERE id = ? FOR UPDATE",
          [it.productId]
        );
        if (!rows || rows.length === 0) {
          throw new HttpError(404, `Product ${it.productId} not found`);
        }

        const p = rows[0];
        const stock = Number.parseInt(String(p.stock ?? 0), 10) || 0;
        if (stock < it.qty) {
          throw new HttpError(400, `Insufficient stock for "${p.name}" (have ${stock}, need ${it.qty})`);
        }

        const baseUnitPrice = toMoney(p.price);
        const baseUnitCost = toMoney(p.costPrice);
        let unitPrice = baseUnitPrice;

        if (it.unitPrice != null) {
          const requested = toMoney(it.unitPrice);

          if (requested > baseUnitPrice) {
            throw new HttpError(400, `Discount price cannot be higher than the product price for "${p.name}"`);
          }

          if (requested < 0) {
            throw new HttpError(400, `Discount price must be >= 0 for "${p.name}"`);
          }

          const isDiscount = requested < baseUnitPrice;
          if (isDiscount && !canDiscount) {
            throw new HttpError(403, "Discount permission required for this cashier");
          }

          unitPrice = requested;
        }

        const lineTotal = toMoney(unitPrice * it.qty);
        subtotal = toMoney(subtotal + lineTotal);

        computedItems.push({
          idx: it.idx,
          productId: p.id,
          name: p.name,
          qty: it.qty,
          unitPrice,
          unitCost: baseUnitCost,
          lineTotal,
        });
      }

      const total = subtotal;

      const saleResult = await queryConn(
        conn,
        "INSERT INTO sales (cashier_id, customer_name, subtotal, total) VALUES (?, ?, ?, ?)",
        [cashier.id, customerName, subtotal, total]
      );
      const saleId = saleResult.insertId;

      const computedItemsOrdered = computedItems.sort((a, b) => a.idx - b.idx);

      for (const it of computedItemsOrdered) {
        await queryConn(
          conn,
          "INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [saleId, it.productId, it.name, it.qty, it.unitPrice, it.unitCost, it.lineTotal]
        );

        const updateResult = await queryConn(conn, "UPDATE products SET stock = stock - ? WHERE id = ?", [
          it.qty,
          it.productId,
        ]);
        if (!updateResult || updateResult.affectedRows === 0) {
          throw new HttpError(500, "Failed to update stock");
        }
      }

      return { saleId, computedItems: computedItemsOrdered.map(({ idx, ...rest }) => rest), subtotal, total };
    });

    // Fetch createdAt from DB (authoritative timestamp).
    const saleRows = await query(
      db,
      `SELECT id, customer_name AS customerName, subtotal, total, created_at AS createdAt
       FROM sales WHERE id = ?`,
      [txResult.saleId]
    );

    return res.status(201).json({
      id: txResult.saleId,
      createdAt: saleRows?.[0]?.createdAt,
      customerName,
      subtotal: txResult.subtotal,
      total: txResult.total,
      cashier: { id: cashier.id, name: cashier.name, role: cashier.role },
      items: txResult.computedItems,
    });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.updateSale = async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid sale id" });

  const rawItems = req.body?.items;
  const customerName = String(req.body?.customerName || "").trim() || null;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: "Sale items are required" });
  }

  const itemsRequest = rawItems
    .map((it) => ({
      productId: parseId(it?.productId),
      qty: parseQty(it?.qty),
      unitPrice: it?.unitPrice == null || it?.unitPrice === "" ? null : parseNumber(it.unitPrice),
    }))
    .filter((it) => it.productId != null && it.qty != null);

  if (itemsRequest.length === 0) {
    return res.status(400).json({ error: "Valid sale items are required" });
  }

  const seen = new Set();
  for (const it of itemsRequest) {
    if (seen.has(it.productId)) {
      return res.status(400).json({ error: "Duplicate productId in items is not allowed" });
    }
    seen.add(it.productId);
  }

  try {
    await withTransaction(db, async (conn) => {
      const saleRows = await queryConn(
        conn,
        "SELECT id, cashier_id AS cashierId, customer_name AS customerName, created_at AS createdAt FROM sales WHERE id = ? FOR UPDATE",
        [id]
      );
      if (!saleRows || saleRows.length === 0) throw new HttpError(404, "Sale not found");

      const sale = saleRows[0];

      const oldItemRows = await queryConn(
        conn,
        `SELECT 
          product_id AS productId,
          product_name AS name,
          qty,
          unit_price AS unitPrice,
          unit_cost AS unitCost,
          line_total AS lineTotal
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC`,
        [id]
      );

      const oldAgg = new Map();
      for (const row of oldItemRows || []) {
        const pid = Number(row.productId);
        const qty = Number(row.qty || 0);
        const unitPrice = toMoney(row.unitPrice);
        const unitCost = toMoney(row.unitCost);
        const lineTotal = toMoney(row.lineTotal);

        const cur = oldAgg.get(pid) || {
          productId: pid,
          name: row.name,
          qty: 0,
          revenue: 0,
          cost: 0,
        };

        cur.qty += qty;
        cur.revenue = toMoney(cur.revenue + (Number.isFinite(lineTotal) ? lineTotal : unitPrice * qty));
        cur.cost = toMoney(cur.cost + (Number.isFinite(unitCost) ? unitCost : 0) * qty);
        cur.name = row.name || cur.name;
        oldAgg.set(pid, cur);
      }

      const oldQtyByPid = new Map();
      for (const [pid, info] of oldAgg.entries()) {
        oldQtyByPid.set(pid, Number(info.qty || 0));
      }

      const newQtyByPid = new Map();
      for (const it of itemsRequest) {
        newQtyByPid.set(Number(it.productId), Number(it.qty || 0));
      }

      const unionIds = new Set([...oldQtyByPid.keys(), ...newQtyByPid.keys()]);
      const productIdsSorted = [...unionIds].sort((a, b) => Number(a) - Number(b));

      const productById = new Map();
      for (const pid of productIdsSorted) {
        const rows = await queryConn(
          conn,
          "SELECT id, name, price, cost_price AS costPrice, stock FROM products WHERE id = ? FOR UPDATE",
          [pid]
        );
        if (rows && rows.length > 0) {
          productById.set(pid, rows[0]);
          continue;
        }

        const oldQty = Number(oldQtyByPid.get(pid) || 0);
        const newQty = Number(newQtyByPid.get(pid) || 0);
        const delta = newQty - oldQty;
        if (delta !== 0) {
          throw new HttpError(404, `Product ${pid} not found (cannot change quantity)`);
        }
      }

      // Validate stock availability for any increases.
      for (const pid of productIdsSorted) {
        if (!productById.has(pid)) continue;
        const oldQty = Number(oldQtyByPid.get(pid) || 0);
        const newQty = Number(newQtyByPid.get(pid) || 0);
        const delta = newQty - oldQty;
        if (delta <= 0) continue;

        const p = productById.get(pid);
        const stock = Number.parseInt(String(p.stock ?? 0), 10) || 0;
        if (stock < delta) {
          throw new HttpError(400, `Insufficient stock for "${p.name}" (need +${delta}, have ${stock})`);
        }
      }

      // Compute new sale lines in the request order.
      let subtotal = 0;
      const computed = [];

      for (const it of itemsRequest) {
        const pid = Number(it.productId);
        const qty = Number(it.qty);
        const old = oldAgg.get(pid) || null;
        const p = productById.get(pid) || null;

        const name = (p && p.name) || (old && old.name) || `Product ${pid}`;

        let unitPrice = it.unitPrice != null ? toMoney(it.unitPrice) : null;
        if (unitPrice == null) {
          if (old && Number(old.qty) > 0) {
            unitPrice = toMoney(Number(old.revenue || 0) / Number(old.qty || 1));
          } else if (p) {
            unitPrice = toMoney(p.price);
          } else {
            throw new HttpError(400, `Missing unitPrice for "${name}"`);
          }
        }

        if (unitPrice < 0) throw new HttpError(400, `unitPrice must be >= 0 for "${name}"`);

        let unitCost = null;
        if (old && Number(old.qty) > 0) {
          unitCost = toMoney(Number(old.cost || 0) / Number(old.qty || 1));
        }
        if (unitCost == null && p) unitCost = toMoney(p.costPrice);
        if (unitCost == null) unitCost = 0;

        const lineTotal = toMoney(unitPrice * qty);
        subtotal = toMoney(subtotal + lineTotal);

        computed.push({
          productId: pid,
          name,
          qty,
          unitPrice,
          unitCost,
          lineTotal,
        });
      }

      const total = subtotal;

      await queryConn(conn, "UPDATE sales SET customer_name = ?, subtotal = ?, total = ? WHERE id = ?", [
        customerName,
        subtotal,
        total,
        id,
      ]);

      await queryConn(conn, "DELETE FROM sale_items WHERE sale_id = ?", [id]);

      for (const it of computed) {
        await queryConn(
          conn,
          "INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, it.productId, it.name, it.qty, it.unitPrice, it.unitCost, it.lineTotal]
        );
      }

      // Apply stock deltas (final stock = current stock - (newQty - oldQty)).
      for (const pid of productIdsSorted) {
        const p = productById.get(pid);
        if (!p) continue;

        const oldQty = Number(oldQtyByPid.get(pid) || 0);
        const newQty = Number(newQtyByPid.get(pid) || 0);
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        if (delta > 0) {
          await queryConn(conn, "UPDATE products SET stock = stock - ? WHERE id = ?", [delta, pid]);
        } else {
          await queryConn(conn, "UPDATE products SET stock = stock + ? WHERE id = ?", [Math.abs(delta), pid]);
        }
      }

      // Keep shift totals consistent when editing historical sales.
      const cashierId = sale.cashierId != null ? Number(sale.cashierId) : null;
      if (cashierId != null && Number.isFinite(cashierId)) {
        await recomputeShiftTotalsForCashierAtTime(conn, cashierId, sale.createdAt);
      }
    });

    // Return the updated sale (same shape as getSaleById).
    const saleRows = await query(
      db,
      `SELECT 
        s.id,
        s.customer_name AS customerName,
        s.subtotal,
        s.total,
        s.created_at AS createdAt,
        u.id AS cashierId,
        u.name AS cashierName
      FROM sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?`,
      [id]
    );

    if (!saleRows || saleRows.length === 0) {
      return res.status(404).json({ error: "Sale not found" });
    }

    const items = await query(
      db,
      `SELECT 
        product_id AS productId,
        product_name AS name,
        qty,
        unit_price AS unitPrice,
        unit_cost AS unitCost,
        line_total AS lineTotal
      FROM sale_items
      WHERE sale_id = ?
      ORDER BY id ASC`,
      [id]
    );

    return res.json({ ...saleRows[0], items: Array.isArray(items) ? items : [] });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.deleteSale = async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid sale id" });

  try {
    const result = await withTransaction(db, async (conn) => {
      const saleRows = await queryConn(
        conn,
        "SELECT id, cashier_id AS cashierId, created_at AS createdAt FROM sales WHERE id = ? FOR UPDATE",
        [id]
      );
      if (!saleRows || saleRows.length === 0) throw new HttpError(404, "Sale not found");

      const sale = saleRows[0];

      const itemRows = await queryConn(
        conn,
        `SELECT
          product_id AS productId,
          product_name AS name,
          SUM(qty) AS qty
        FROM sale_items
        WHERE sale_id = ?
        GROUP BY product_id, product_name
        ORDER BY product_id ASC`,
        [id]
      );

      const missingProducts = [];

      for (const row of itemRows || []) {
        const productId = Number(row.productId);
        const qty = Number.parseInt(String(row.qty || 0), 10) || 0;
        if (!Number.isFinite(productId) || qty <= 0) continue;

        const productRows = await queryConn(conn, "SELECT id, name FROM products WHERE id = ? FOR UPDATE", [
          productId,
        ]);

        if (!productRows || productRows.length === 0) {
          missingProducts.push({
            productId,
            name: row.name || `Product ${productId}`,
            qty,
          });
          continue;
        }

        await queryConn(conn, "UPDATE products SET stock = stock + ? WHERE id = ?", [qty, productId]);
      }

      // Delete sale (sale_items will cascade).
      await queryConn(conn, "DELETE FROM sales WHERE id = ?", [id]);

      const cashierId = sale.cashierId != null ? Number(sale.cashierId) : null;
      if (cashierId != null && Number.isFinite(cashierId)) {
        await recomputeShiftTotalsForCashierAtTime(conn, cashierId, sale.createdAt);
      }

      return { missingProducts };
    });

    return res.json({ success: true, id, missingProducts: result.missingProducts || [] });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};
