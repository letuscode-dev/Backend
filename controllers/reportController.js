const db = require("../config/db");

function query(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
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

exports.getOverview = async (req, res) => {
  try {
    const viewer = req.user;

    const from = normalizeMySqlDateTime(req.query.from, "from");
    const to = normalizeMySqlDateTime(req.query.to, "to");
    if (!from || !to) {
      return res.status(400).json({ error: "from and to are required (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)" });
    }
    if (from > to) return res.status(400).json({ error: "from must be <= to" });

    const summaryRows = await query(
      `SELECT
        COUNT(*) AS salesCount,
        COALESCE(SUM(subtotal), 0) AS subtotal,
        COALESCE(SUM(total), 0) AS total
      FROM sales
      WHERE created_at >= ? AND created_at <= ?`,
      [from, to]
    );

    const itemAggRows = await query(
      `SELECT
        COALESCE(SUM(si.qty), 0) AS itemsSold,
        COUNT(DISTINCT si.product_id) AS productsSold
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      WHERE s.created_at >= ? AND s.created_at <= ?`,
      [from, to]
    );

    const cogsRows = await query(
      `SELECT
        COALESCE(SUM(COALESCE(NULLIF(si.unit_cost, 0), p.cost_price, 0) * si.qty), 0) AS cogs
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.created_at >= ? AND s.created_at <= ?`,
      [from, to]
    );

    const expenseSummaryRows = await query(
      `SELECT
        COUNT(*) AS entriesCount,
        COALESCE(SUM(amount), 0) AS totalExpenses
      FROM expenses
      WHERE spent_at >= ? AND spent_at <= ?`,
      [from, to]
    );

    const expensesByUser = await query(
      `SELECT
        u.id AS userId,
        u.name AS userName,
        u.username,
        COUNT(e.id) AS entriesCount,
        COALESCE(SUM(e.amount), 0) AS totalAmount
      FROM expenses e
      JOIN users u ON u.id = e.user_id
      WHERE e.spent_at >= ? AND e.spent_at <= ?
      GROUP BY u.id, u.name, u.username
      ORDER BY totalAmount DESC, entriesCount DESC, u.name ASC`,
      [from, to]
    );

    const expenses = await query(
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
      WHERE e.spent_at >= ? AND e.spent_at <= ?
      ORDER BY e.spent_at DESC, e.id DESC
      LIMIT 500`,
      [from, to]
    );

    const products = await query(
      `SELECT
        p.id AS productId,
        p.name,
        p.price AS currentPrice,
        p.cost_price AS currentCost,
        p.stock AS currentStock,
        COALESCE(agg.qtySold, 0) AS qtySold,
        COALESCE(agg.revenue, 0) AS revenue,
        COALESCE(agg.cogs, 0) AS cogs,
        (COALESCE(agg.revenue, 0) - COALESCE(agg.cogs, 0)) AS grossProfit,
        CASE
          WHEN COALESCE(agg.revenue, 0) > 0 THEN ROUND(((COALESCE(agg.revenue, 0) - COALESCE(agg.cogs, 0)) / COALESCE(agg.revenue, 0)) * 100, 2)
          ELSE NULL
        END AS marginPct,
        agg.avgUnitPrice AS avgUnitPrice,
        agg.minUnitPrice AS minUnitPrice,
        agg.maxUnitPrice AS maxUnitPrice,
        agg.avgUnitCost AS avgUnitCost,
        agg.minUnitCost AS minUnitCost,
        agg.maxUnitCost AS maxUnitCost,
        COALESCE(agg.linesCount, 0) AS linesCount
      FROM products p
      LEFT JOIN (
        SELECT
          si.product_id,
          SUM(si.qty) AS qtySold,
          SUM(si.line_total) AS revenue,
          SUM(COALESCE(NULLIF(si.unit_cost, 0), p2.cost_price, 0) * si.qty) AS cogs,
          CASE
            WHEN SUM(si.qty) > 0 THEN ROUND(SUM(si.unit_price * si.qty) / SUM(si.qty), 2)
            ELSE NULL
          END AS avgUnitPrice,
          MIN(si.unit_price) AS minUnitPrice,
          MAX(si.unit_price) AS maxUnitPrice,
          CASE
            WHEN SUM(si.qty) > 0 THEN ROUND(SUM(COALESCE(NULLIF(si.unit_cost, 0), p2.cost_price, 0) * si.qty) / SUM(si.qty), 2)
            ELSE NULL
          END AS avgUnitCost,
          MIN(COALESCE(NULLIF(si.unit_cost, 0), p2.cost_price, 0)) AS minUnitCost,
          MAX(COALESCE(NULLIF(si.unit_cost, 0), p2.cost_price, 0)) AS maxUnitCost,
          COUNT(*) AS linesCount
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id
        LEFT JOIN products p2 ON p2.id = si.product_id
        WHERE s.created_at >= ? AND s.created_at <= ?
        GROUP BY si.product_id
      ) agg ON agg.product_id = p.id
      ORDER BY revenue DESC, qtySold DESC, p.name ASC`,
      [from, to]
    );

    // Detailed line items (preview) for "what was bought at what price".
    // Keep this bounded so large date ranges don't blow up the UI.
    const lines = await query(
      `SELECT
        s.id AS saleId,
        s.created_at AS createdAt,
        s.customer_name AS customerName,
        u.id AS cashierId,
        u.name AS cashierName,
        si.product_id AS productId,
        si.product_name AS productName,
        si.qty,
        si.unit_price AS unitPrice,
        COALESCE(NULLIF(si.unit_cost, 0), p.cost_price, 0) AS unitCost,
        si.line_total AS lineTotal,
        ROUND(COALESCE(NULLIF(si.unit_cost, 0), p.cost_price, 0) * si.qty, 2) AS lineCogs,
        ROUND(si.line_total - (COALESCE(NULLIF(si.unit_cost, 0), p.cost_price, 0) * si.qty), 2) AS lineProfit
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.created_at >= ? AND s.created_at <= ?
      ORDER BY s.created_at DESC, s.id DESC, si.id DESC
      LIMIT 500`,
      [from, to]
    );

    const summary = summaryRows?.[0] || { salesCount: 0, subtotal: 0, total: 0 };
    const agg = itemAggRows?.[0] || { itemsSold: 0, productsSold: 0 };
    const cogsSummary = cogsRows?.[0] || { cogs: 0 };
    const expenseSummary = expenseSummaryRows?.[0] || { entriesCount: 0, totalExpenses: 0 };
    const avgSale = Number(summary.salesCount) > 0 ? Number(summary.total) / Number(summary.salesCount) : 0;
    const cogs = Number(cogsSummary.cogs || 0);
    const revenue = Number(summary.total || 0);
    const grossProfit = revenue - cogs;
    const marginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null;
    const totalExpenses = Number(expenseSummary.totalExpenses || 0);
    const netAfterExpenses = grossProfit - totalExpenses;

    return res.json({
      from,
      to,
      viewer: { id: viewer.id, name: viewer.name, role: viewer.role },
      summary: {
        salesCount: Number(summary.salesCount || 0),
        itemsSold: Number(agg.itemsSold || 0),
        productsSold: Number(agg.productsSold || 0),
        subtotal: Number(summary.subtotal || 0),
        total: revenue,
        cogs,
        grossProfit: Math.round(grossProfit * 100) / 100,
        totalExpenses,
        netAfterExpenses: Math.round(netAfterExpenses * 100) / 100,
        marginPct,
        avgSale: Number.isFinite(avgSale) ? Math.round(avgSale * 100) / 100 : 0,
        expenseEntries: Number(expenseSummary.entriesCount || 0),
      },
      expensesSummary: {
        totalExpenses,
        entriesCount: Number(expenseSummary.entriesCount || 0),
      },
      expensesByUser: Array.isArray(expensesByUser) ? expensesByUser : [],
      expenses: Array.isArray(expenses) ? expenses : [],
      products: Array.isArray(products) ? products : [],
      lines: Array.isArray(lines) ? lines : [],
      lineLimit: 500,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
