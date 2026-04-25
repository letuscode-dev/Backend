const db = require("../config/db");
const { HttpError, query, queryConn, withTransaction } = require("../lib/dbTx");

function parseId(idRaw) {
  const id = Number.parseInt(String(idRaw), 10);
  return Number.isFinite(id) ? id : null;
}

function parseNullableInt(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

exports.listSessions = async (req, res) => {
  try {
    const rows = await query(
      db,
      `SELECT
        s.id,
        s.name,
        s.status,
        s.note,
        s.created_by AS createdBy,
        s.created_at AS createdAt,
        s.closed_by AS closedBy,
        s.closed_at AS closedAt,
        s.from_at AS fromAt,
        s.to_at AS toAt,
        COALESCE(cnt.itemsCount, 0) AS itemsCount,
        COALESCE(cnt.countedCount, 0) AS countedCount
      FROM stocktake_sessions s
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS itemsCount, SUM(CASE WHEN counted_stock IS NULL THEN 0 ELSE 1 END) AS countedCount
        FROM stocktake_items
        GROUP BY session_id
      ) cnt ON cnt.session_id = s.id
      ORDER BY s.id DESC
      LIMIT 100`,
      []
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.createSession = async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const note = String(req.body?.note || "").trim() || null;
  const fromAtRaw = req.body?.fromAt == null ? null : String(req.body.fromAt).trim();
  const toAtRaw = req.body?.toAt == null ? null : String(req.body.toAt).trim();

  try {
    const viewer = req.user;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const txResult = await withTransaction(db, async (conn) => {
      const sessionResult = await queryConn(
        conn,
        "INSERT INTO stocktake_sessions (name, status, note, created_by, from_at, to_at) VALUES (?, 'open', ?, ?, ?, ?)",
        [name, note, viewer.id, fromAtRaw || null, toAtRaw || null]
      );
      const sessionId = sessionResult.insertId;

      const products = await queryConn(
        conn,
        "SELECT id, name, price, cost_price AS costPrice, stock FROM products ORDER BY id ASC",
        []
      );

      for (const p of products) {
        const expectedStock = Number.parseInt(String(p.stock ?? 0), 10) || 0;
        const snapshotPrice = Number(p.price ?? 0) || 0;
        const snapshotCost = Number(p.costPrice ?? 0) || 0;

        await queryConn(
          conn,
          "INSERT INTO stocktake_items (session_id, product_id, product_name, expected_stock, counted_stock, snapshot_price, snapshot_cost) VALUES (?, ?, ?, ?, NULL, ?, ?)",
          [sessionId, p.id, p.name, expectedStock, snapshotPrice, snapshotCost]
        );
      }

      const createdRows = await queryConn(
        conn,
        "SELECT created_at AS createdAt FROM stocktake_sessions WHERE id = ?",
        [sessionId]
      );

      return {
        sessionId,
        createdAt: createdRows?.[0]?.createdAt || null,
        itemsCount: Array.isArray(products) ? products.length : 0,
      };
    });

    return res.status(201).json({
      id: txResult.sessionId,
      name,
      status: "open",
      note,
      createdBy: viewer.id,
      createdAt: txResult.createdAt || new Date().toISOString(),
      closedBy: null,
      closedAt: null,
      fromAt: fromAtRaw || null,
      toAt: toAtRaw || null,
      itemsCount: txResult.itemsCount,
      countedCount: 0,
    });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.getSessionById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid session id" });

    const sessionRows = await query(
      db,
      `SELECT
        id,
        name,
        status,
        note,
        created_by AS createdBy,
        created_at AS createdAt,
        closed_by AS closedBy,
        closed_at AS closedAt,
        from_at AS fromAt,
        to_at AS toAt
      FROM stocktake_sessions
      WHERE id = ?`,
      [id]
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const items = await query(
      db,
      `SELECT
        si.product_id AS productId,
        si.product_name AS productName,
        si.expected_stock AS expectedStock,
        si.counted_stock AS countedStock,
        (si.counted_stock - si.expected_stock) AS variance,
        si.snapshot_price AS snapshotPrice,
        si.snapshot_cost AS snapshotCost,
        p.stock AS currentStock
      FROM stocktake_items si
      LEFT JOIN products p ON p.id = si.product_id
      WHERE si.session_id = ?
      ORDER BY si.product_name ASC`,
      [id]
    );

    return res.json({ ...sessionRows[0], items: Array.isArray(items) ? items : [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.updateCounts = async (req, res) => {
  const rawItems = req.body?.items;

  try {
    // Admin check happens at the route level.

    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid session id" });

    const itemsRequest = Array.isArray(rawItems)
      ? rawItems
          .map((it) => ({
            productId: parseId(it?.productId),
            countedStock: parseNullableInt(it?.countedStock),
          }))
          .filter((it) => it.productId != null)
      : [];

    if (itemsRequest.length === 0) {
      return res.json({ success: true, updated: 0 });
    }

    const updated = await withTransaction(db, async (conn) => {
      const sessionRows = await queryConn(conn, "SELECT id, status FROM stocktake_sessions WHERE id = ? FOR UPDATE", [
        id,
      ]);
      if (!sessionRows || sessionRows.length === 0) throw new HttpError(404, "Session not found");
      if (String(sessionRows[0].status) !== "open") throw new HttpError(400, "Session is closed");

      let updated = 0;
      for (const it of itemsRequest) {
        if (it.countedStock != null && it.countedStock < 0) {
          throw new HttpError(400, "Counted stock must be >= 0");
        }

        const result = await queryConn(
          conn,
          "UPDATE stocktake_items SET counted_stock = ? WHERE session_id = ? AND product_id = ?",
          [it.countedStock, id, it.productId]
        );
        updated += result?.affectedRows ? Number(result.affectedRows) : 0;
      }

      return updated;
    });

    return res.json({ success: true, updated: Number(updated || 0) });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};

exports.closeSession = async (req, res) => {
  try {
    const viewer = req.user;

    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid session id" });

    const applied = await withTransaction(db, async (conn) => {
      const sessionRows = await queryConn(conn, "SELECT id, status FROM stocktake_sessions WHERE id = ? FOR UPDATE", [
        id,
      ]);
      if (!sessionRows || sessionRows.length === 0) throw new HttpError(404, "Session not found");
      if (String(sessionRows[0].status) !== "open") throw new HttpError(400, "Session is already closed");

      const countedItems = await queryConn(
        conn,
        "SELECT product_id AS productId, counted_stock AS countedStock FROM stocktake_items WHERE session_id = ? AND counted_stock IS NOT NULL",
        [id]
      );

      if (!countedItems || countedItems.length === 0) {
        throw new HttpError(400, "Enter at least one counted stock value before closing");
      }

      const lockItems = [...countedItems].sort((a, b) => Number(a.productId) - Number(b.productId));

      let applied = 0;
      for (const it of lockItems) {
        if (Number(it.countedStock) < 0) throw new HttpError(400, "Counted stock must be >= 0");

        const productRows = await queryConn(conn, "SELECT id FROM products WHERE id = ? FOR UPDATE", [it.productId]);
        if (!productRows || productRows.length === 0) {
          throw new HttpError(400, `Product ${it.productId} not found (cannot apply stocktake)`);
        }

        await queryConn(conn, "UPDATE products SET stock = ? WHERE id = ?", [it.countedStock, it.productId]);
        applied += 1;
      }

      await queryConn(
        conn,
        "UPDATE stocktake_sessions SET status = 'closed', closed_by = ?, closed_at = NOW() WHERE id = ?",
        [viewer.id, id]
      );

      return applied;
    });

    return res.json({ success: true, id, status: "closed", applied: Number(applied || 0) });
  } catch (err) {
    const status = err instanceof HttpError && Number.isFinite(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err?.message || "Request failed" });
  }
};
