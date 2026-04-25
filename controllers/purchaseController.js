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

function toMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

exports.getPurchases = async (req, res) => {
  try {
    const rows = await query(
      db,
      `SELECT
        p.id,
        p.supplier_name AS supplierName,
        p.status,
        p.note,
        p.created_by AS createdBy,
        p.created_at AS createdAt,
        p.received_at AS receivedAt,
        COALESCE(pi.itemsCount, 0) AS itemsCount,
        COALESCE(pi.totalCost, 0) AS totalCost
      FROM purchases p
      LEFT JOIN (
        SELECT purchase_id, COUNT(*) AS itemsCount, COALESCE(SUM(line_total), 0) AS totalCost
        FROM purchase_items
        GROUP BY purchase_id
      ) pi ON pi.purchase_id = p.id
      ORDER BY p.id DESC
      LIMIT 200`,
      []
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid purchase id" });

    const headerRows = await query(
      db,
      `SELECT
        id,
        supplier_name AS supplierName,
        status,
        note,
        created_by AS createdBy,
        created_at AS createdAt,
        received_at AS receivedAt
      FROM purchases
      WHERE id = ?`,
      [id]
    );

    if (!headerRows || headerRows.length === 0) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const items = await query(
      db,
      `SELECT
        id,
        product_id AS productId,
        product_name AS productName,
        qty,
        unit_cost AS unitCost,
        line_total AS lineTotal
      FROM purchase_items
      WHERE purchase_id = ?
      ORDER BY id ASC`,
      [id]
    );

    return res.json({ ...headerRows[0], items: Array.isArray(items) ? items : [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.createPurchase = async (req, res) => {
  const supplierName = String(req.body?.supplierName || "").trim() || null;
  const note = String(req.body?.note || "").trim() || null;
  const rawItems = req.body?.items;

  try {
    const viewer = req.user;

    const itemsRequest = Array.isArray(rawItems)
      ? rawItems
          .map((it) => ({
            productId: parseId(it?.productId),
            qty: parseQty(it?.qty),
            unitCost: parseNumber(it?.unitCost),
          }))
          .filter((it) => it.productId != null && it.qty != null && it.unitCost != null)
      : [];

    const txResult = await withTransaction(db, async (conn) => {
      const purchaseResult = await queryConn(
        conn,
        "INSERT INTO purchases (supplier_name, status, note, created_by) VALUES (?, 'draft', ?, ?)",
        [supplierName, note, viewer.id]
      );
      const purchaseId = purchaseResult.insertId;

      const createdItems = [];
      for (const it of itemsRequest) {
        const productRows = await queryConn(conn, "SELECT id, name FROM products WHERE id = ?", [it.productId]);
        if (!productRows || productRows.length === 0) {
          throw new HttpError(400, `Invalid productId ${it.productId}`);
        }

        const unitCost = toMoney(it.unitCost);
        if (unitCost < 0) throw new HttpError(400, "Unit cost must be >= 0");

        const lineTotal = toMoney(unitCost * it.qty);
        const p = productRows[0];

        const itemResult = await queryConn(
          conn,
          "INSERT INTO purchase_items (purchase_id, product_id, product_name, qty, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?)",
          [purchaseId, p.id, p.name, it.qty, unitCost, lineTotal]
        );

        createdItems.push({
          id: itemResult.insertId,
          productId: p.id,
          productName: p.name,
          qty: it.qty,
          unitCost,
          lineTotal,
        });
      }

      return { purchaseId, createdItems };
    });

    const headerRows = await query(
      db,
      `SELECT
        id,
        supplier_name AS supplierName,
        status,
        note,
        created_by AS createdBy,
        created_at AS createdAt,
        received_at AS receivedAt
      FROM purchases
      WHERE id = ?`,
      [txResult.purchaseId]
    );

    return res.status(201).json({
      ...(headerRows?.[0] || {
        id: txResult.purchaseId,
        supplierName,
        status: "draft",
        note,
        createdBy: viewer.id,
        createdAt: new Date().toISOString(),
        receivedAt: null,
      }),
      items: txResult.createdItems,
    });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.replacePurchaseItems = async (req, res) => {
  const rawItems = req.body?.items;

  try {
    // Admin check happens at the route level.

    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid purchase id" });

    const itemsRequest = Array.isArray(rawItems)
      ? rawItems
          .map((it) => ({
            productId: parseId(it?.productId),
            qty: parseQty(it?.qty),
            unitCost: parseNumber(it?.unitCost),
          }))
          .filter((it) => it.productId != null && it.qty != null && it.unitCost != null)
      : [];

    const createdItems = await withTransaction(db, async (conn) => {
      const headerRows = await queryConn(conn, "SELECT id, status FROM purchases WHERE id = ? FOR UPDATE", [id]);
      if (!headerRows || headerRows.length === 0) throw new HttpError(404, "Purchase not found");
      if (String(headerRows[0].status) !== "draft") {
        throw new HttpError(400, "Only draft purchases can be edited");
      }

      await queryConn(conn, "DELETE FROM purchase_items WHERE purchase_id = ?", [id]);

      const createdItems = [];
      for (const it of itemsRequest) {
        const productRows = await queryConn(conn, "SELECT id, name FROM products WHERE id = ?", [it.productId]);
        if (!productRows || productRows.length === 0) {
          throw new HttpError(400, `Invalid productId ${it.productId}`);
        }

        const unitCost = toMoney(it.unitCost);
        if (unitCost < 0) throw new HttpError(400, "Unit cost must be >= 0");

        const lineTotal = toMoney(unitCost * it.qty);
        const p = productRows[0];

        const itemResult = await queryConn(
          conn,
          "INSERT INTO purchase_items (purchase_id, product_id, product_name, qty, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?)",
          [id, p.id, p.name, it.qty, unitCost, lineTotal]
        );

        createdItems.push({
          id: itemResult.insertId,
          productId: p.id,
          productName: p.name,
          qty: it.qty,
          unitCost,
          lineTotal,
        });
      }
      return createdItems;
    });

    return res.json({ id, items: createdItems });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.receivePurchase = async (req, res) => {
  try {
    // Admin check happens at the route level.

    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid purchase id" });

    await withTransaction(db, async (conn) => {
      const headerRows = await queryConn(conn, "SELECT id, status FROM purchases WHERE id = ? FOR UPDATE", [id]);
      if (!headerRows || headerRows.length === 0) throw new HttpError(404, "Purchase not found");

      const status = String(headerRows[0].status);
      if (status !== "draft") throw new HttpError(400, `Purchase is not draft (status: ${status})`);

      const items = await queryConn(
        conn,
        "SELECT product_id AS productId, product_name AS productName, qty, unit_cost AS unitCost FROM purchase_items WHERE purchase_id = ?",
        [id]
      );

      if (!items || items.length === 0) {
        throw new HttpError(400, "Add at least one item before receiving this purchase");
      }

      const lockItems = [...items].sort((a, b) => Number(a.productId) - Number(b.productId));

      for (const it of lockItems) {
        const productRows = await queryConn(
          conn,
          "SELECT id, stock, cost_price AS costPrice FROM products WHERE id = ? FOR UPDATE",
          [it.productId]
        );
        if (!productRows || productRows.length === 0) {
          throw new HttpError(400, `Product ${it.productId} not found (cannot receive)`);
        }

        const p = productRows[0];
        const existingStock = Number.parseInt(String(p.stock ?? 0), 10) || 0;
        const existingCost = toMoney(p.costPrice);
        const incomingQty = Number.parseInt(String(it.qty ?? 0), 10) || 0;
        const incomingCost = toMoney(it.unitCost);

        const newStock = existingStock + incomingQty;
        const newCost =
          newStock > 0
            ? toMoney((existingStock * existingCost + incomingQty * incomingCost) / newStock)
            : incomingCost;

        await queryConn(conn, "UPDATE products SET stock = ?, cost_price = ? WHERE id = ?", [
          newStock,
          newCost,
          p.id,
        ]);
      }

      await queryConn(conn, "UPDATE purchases SET status = 'received', received_at = NOW() WHERE id = ?", [id]);
    });

    return res.json({ success: true, id, status: "received" });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};
