import { useEffect, useMemo, useState } from "react";
import { getStocktakeReport } from "../api/reports.js";
import { listShifts } from "../api/shifts.js";
import {
  closeStocktakeSession,
  createStocktakeSession,
  getStocktakeSessionById,
  listStocktakeSessions,
  updateStocktakeCounts,
} from "../api/stocktakes.js";
import Modal from "../components/ui/Modal.jsx";

const LOW_STOCK_THRESHOLD = 5;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toLocalDateInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatCurrency(amountRaw) {
  const amount = Number(amountRaw ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatDateTime(isoLike) {
  try {
    const d = new Date(isoLike);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return String(isoLike);
  }
}

function formatPercent(pctRaw) {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return "-";
  return `${pct.toFixed(2)}%`;
}

function getStatus(stockRaw) {
  const stock = Number(stockRaw ?? 0);
  if (stock <= 0) return { label: "Out of Stock", tone: "danger" };
  if (stock <= LOW_STOCK_THRESHOLD) return { label: "Low Stock", tone: "warn" };
  return { label: "In Stock", tone: "ok" };
}

export default function ReportsPage({ search, onSearchChange, me }) {
  const isAdmin = useMemo(() => String(me?.role || "").toLowerCase() === "admin", [me]);

  const today = useMemo(() => new Date(), []);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toLocalDateInputValue(d);
  });
  const [toDate, setToDate] = useState(() => toLocalDateInputValue(today));

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sessions, setSessions] = useState(null);
  const [sessionsError, setSessionsError] = useState("");
  const [shifts, setShifts] = useState(null);
  const [shiftsError, setShiftsError] = useState("");

  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionForm, setNewSessionForm] = useState({ name: "", note: "" });
  const [newSessionError, setNewSessionError] = useState("");
  const [newSessionSaving, setNewSessionSaving] = useState(false);

  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");

  const visibleSessions = isAdmin ? sessions : [];
  const visibleShifts = isAdmin ? shifts : [];

  const refreshSessions = ({ signal } = {}) => {
    if (!isAdmin) return Promise.resolve([]);

    return listStocktakeSessions({ signal })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setSessionsError("");
        setSessions(list);
        return list;
      })
      .catch((err) => {
        if (err?.name === "AbortError") return [];
        setSessionsError(err?.message || "Failed to load sessions");
        setSessions([]);
        return [];
      });
  };

  const refreshShifts = ({ signal } = {}) => {
    if (!isAdmin) return Promise.resolve([]);

    return listShifts({ signal })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setShiftsError("");
        setShifts(list);
        return list;
      })
      .catch((err) => {
        if (err?.name === "AbortError") return [];
        setShiftsError(err?.message || "Failed to load shifts");
        setShifts([]);
        return [];
      });
  };

  useEffect(() => {
    if (!isAdmin) {
      setSessions([]);
      setShifts([]);
      return;
    }
    const controller = new AbortController();

    Promise.all([refreshSessions({ signal: controller.signal }), refreshShifts({ signal: controller.signal })]);

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const runStocktake = () => {
    setError("");

    if (!isAdmin) {
      setError("Admin access required to run this report.");
      return;
    }
    if (!fromDate || !toDate) {
      setError("Select a date range (from and to).");
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    getStocktakeReport({
      from: `${fromDate} 00:00:00`,
      to: `${toDate} 23:59:59`,
      signal: controller.signal,
    })
      .then((data) => {
        setReport(data);
        setError("");
      })
      .catch((err) => setError(err?.message || "Failed to generate stock take"))
      .finally(() => setLoading(false));

    return () => controller.abort();
  };

  const filteredProducts = useMemo(() => {
    const list = Array.isArray(report?.products) ? report.products : [];
    const q = String(search || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      return (
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.productId || "").toLowerCase().includes(q)
      );
    });
  }, [report, search]);

  const filteredLines = useMemo(() => {
    const list = Array.isArray(report?.lines) ? report.lines : [];
    const q = String(search || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((l) => {
      return (
        String(l.saleId || "").toLowerCase().includes(q) ||
        String(l.cashierName || "").toLowerCase().includes(q) ||
        String(l.customerName || "").toLowerCase().includes(q) ||
        String(l.productName || "").toLowerCase().includes(q)
      );
    });
  }, [report, search]);

  const openCreateSession = () => {
    setNewSessionError("");
    setNewSessionForm({
      name: `Stocktake Session ${toDate}`,
      note: "",
    });
    setNewSessionOpen(true);
  };

  const createSession = () => {
    setNewSessionError("");
    if (!isAdmin) {
      setNewSessionError("Admin access required.");
      return;
    }

    const name = newSessionForm.name.trim();
    const note = newSessionForm.note.trim() || null;
    if (!name) {
      setNewSessionError("Session name is required.");
      return;
    }

    setNewSessionSaving(true);
    createStocktakeSession({
      name,
      note,
      fromAt: `${fromDate} 00:00:00`,
      toAt: `${toDate} 23:59:59`,
    })
      .then(() => refreshSessions())
      .then(() => setNewSessionOpen(false))
      .catch((err) => setNewSessionError(err?.message || "Failed to create session"))
      .finally(() => setNewSessionSaving(false));
  };

  const openSession = (id) => {
    setSessionError("");
    if (!isAdmin) {
      setSessionError("Admin access required.");
      return;
    }

    setSessionModalOpen(true);
    setActiveSession(null);
    setSessionFilter("");

    const controller = new AbortController();
    getStocktakeSessionById(id, { signal: controller.signal })
      .then((data) => setActiveSession(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setSessionError(err?.message || "Failed to load session");
      });

    return () => controller.abort();
  };

  const updateCountedStockLocal = (productId, raw) => {
    setActiveSession((prev) => {
      if (!prev) return prev;
      const nextItems = (prev.items || []).map((it) => {
        if (it.productId !== productId) return it;
        if (raw === "" || raw == null) return { ...it, countedStock: null };
        const parsed = Number.parseInt(String(raw), 10);
        return Number.isFinite(parsed) ? { ...it, countedStock: parsed } : { ...it, countedStock: null };
      });
      return { ...prev, items: nextItems };
    });
  };

  const saveSessionCounts = () => {
    setSessionError("");
    if (!activeSession?.id) return;
    if (!isAdmin) {
      setSessionError("Admin access required.");
      return;
    }

    const items = (activeSession.items || [])
      .filter((it) => it.countedStock != null)
      .map((it) => ({ productId: it.productId, countedStock: it.countedStock }));

    setSessionBusy(true);
    updateStocktakeCounts(activeSession.id, { items })
      .then(() => getStocktakeSessionById(activeSession.id))
      .then((data) => setActiveSession(data))
      .then(() => refreshSessions())
      .catch((err) => setSessionError(err?.message || "Failed to save counts"))
      .finally(() => setSessionBusy(false));
  };

  const closeSession = () => {
    setSessionError("");
    if (!activeSession?.id) return;
    if (!isAdmin) {
      setSessionError("Admin access required.");
      return;
    }

    if (!window.confirm("Apply counted stock to inventory and close this session?")) return;

    const items = (activeSession.items || [])
      .filter((it) => it.countedStock != null)
      .map((it) => ({ productId: it.productId, countedStock: it.countedStock }));

    setSessionBusy(true);
    updateStocktakeCounts(activeSession.id, { items })
      .then(() => closeStocktakeSession(activeSession.id, {}))
      .then(() => refreshSessions())
      .then(() => setSessionModalOpen(false))
      .catch((err) => setSessionError(err?.message || "Failed to close session"))
      .finally(() => setSessionBusy(false));
  };

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Reports</h1>
          <p>Run stock takes and understand what sold, at what price, and what's left.</p>
        </div>
      </div>

      {error ? <div className="banner" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="grid">
        <div className="card col-12">
          <div className="card-header">
            <h3>Stock Take</h3>
            <button className="btn primary" type="button" onClick={runStocktake} disabled={loading || !isAdmin}>
              {loading ? "Generating..." : "Generate"}
            </button>
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <div className="field" style={{ flex: "0 0 200px" }}>
              <label>From</label>
              <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>

            <div className="field" style={{ flex: "0 0 200px" }}>
              <label>To</label>
              <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>

            <div className="field" style={{ flex: "1 1 260px" }}>
              <label>Filter</label>
              <input
                className="input"
                value={search}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder="Filter products, cashiers, receipts..."
              />
            </div>
          </div>

          {!isAdmin ? (
            <div className="banner">Admin access required to run this report.</div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              This report shows a preview of up to {report?.lineLimit ?? 500} line items for the date range.
            </div>
          )}
        </div>

	        {report ? (
	          <>
            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Revenue</div>
              <div className="kpi-value">{formatCurrency(report.summary?.total || 0)}</div>
              <p className="kpi-sub">{Number(report.summary?.salesCount || 0).toLocaleString()} sales</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>COGS</div>
              <div className="kpi-value">{formatCurrency(report.summary?.cogs || 0)}</div>
              <p className="kpi-sub">Cost of goods sold</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Gross Profit</div>
              <div className="kpi-value">{formatCurrency(report.summary?.grossProfit || 0)}</div>
              <p className="kpi-sub">Revenue minus COGS</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Margin</div>
              <div className="kpi-value">{formatPercent(report.summary?.marginPct)}</div>
              <p className="kpi-sub">Gross profit / revenue</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Items Sold</div>
              <div className="kpi-value">{Number(report.summary?.itemsSold || 0).toLocaleString()}</div>
              <p className="kpi-sub">Units sold</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Products Sold</div>
              <div className="kpi-value">{Number(report.summary?.productsSold || 0).toLocaleString()}</div>
              <p className="kpi-sub">Unique SKUs sold</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Average Sale</div>
              <div className="kpi-value">{formatCurrency(report.summary?.avgSale || 0)}</div>
              <p className="kpi-sub">Across the selected range</p>
            </div>

            <div className="card col-3">
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Range</div>
              <div style={{ fontSize: 14, fontWeight: 900, marginTop: 10 }}>
                {String(report.from).slice(0, 10)} to {String(report.to).slice(0, 10)}
              </div>
              <p className="kpi-sub">Viewer: {report.viewer?.name || "-"}</p>
            </div>

            <div className="card col-12">
              <div className="card-header">
                <h3>Inventory & Sales Breakdown</h3>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  {filteredProducts.length} products
                </div>
              </div>

              <div className="table-wrap" aria-label="Inventory breakdown">
                <table className="table table-plain table-wide">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Sold</th>
                      <th>Avg Sold Price</th>
                      <th>Avg Cost</th>
                      <th>Revenue</th>
                      <th>Profit</th>
                      <th>Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length > 0 ? (
                      filteredProducts.map((p) => {
                        const status = getStatus(p.currentStock);
                        const revenue = Number(p.revenue || 0);
                        const cogs = Number(p.cogs || 0);
                        const profit = Number(p.grossProfit ?? revenue - cogs);
                        const marginPct =
                          p.marginPct != null ? Number(p.marginPct) : revenue > 0 ? (profit / revenue) * 100 : null;

                        return (
                          <tr key={p.productId}>
                            <td>
                              <strong style={{ letterSpacing: -0.2 }}>{p.name}</strong>
                              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                                #{p.productId} - Price {formatCurrency(p.currentPrice || 0)} - Cost{" "}
                                {formatCurrency(p.currentCost || 0)}
                              </div>
                            </td>
                            <td>{Number(p.qtySold || 0).toLocaleString()}</td>
                            <td>{p.avgUnitPrice == null ? "-" : formatCurrency(p.avgUnitPrice)}</td>
                            <td>{p.avgUnitCost == null ? "-" : formatCurrency(p.avgUnitCost)}</td>
                            <td>
                              <div style={{ fontWeight: 900 }}>{formatCurrency(revenue)}</div>
                              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                                COGS {formatCurrency(cogs)}
                              </div>
                            </td>
                            <td>
                              <div
                                style={{
                                  fontWeight: 900,
                                  color: profit < 0 ? "var(--danger)" : "var(--ok)",
                                }}
                              >
                                {formatCurrency(profit)}
                              </div>
                              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                                Margin {formatPercent(marginPct)}
                              </div>
                            </td>
                            <td>{Number(p.currentStock || 0).toLocaleString()}</td>
                            <td>
                              <span className={`badge ${status.tone}`}>{status.label}</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8}>No products found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card col-12">
              <div className="card-header">
                <h3>Line Items (Preview)</h3>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  Showing {filteredLines.length} lines
                </div>
              </div>

              <div className="table-wrap" aria-label="Line items preview">
                <table className="table table-plain table-wide">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sale</th>
                      <th>Cashier</th>
                      <th>Customer</th>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Unit Cost</th>
                      <th>Total</th>
                      <th>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines.length > 0 ? (
                      filteredLines.map((l) => (
                        <tr key={`${l.saleId}-${l.productId}-${l.createdAt}-${l.unitPrice}`}>
                          <td>{formatDateTime(l.createdAt)}</td>
                          <td>#{l.saleId}</td>
                          <td>{l.cashierName || "-"}</td>
                          <td>{l.customerName || "Walk-in"}</td>
                          <td>{l.productName}</td>
                          <td>{Number(l.qty || 0).toLocaleString()}</td>
                          <td>{formatCurrency(l.unitPrice || 0)}</td>
                          <td>{formatCurrency(l.unitCost || 0)}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(l.lineTotal || 0)}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(l.lineProfit || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10}>No line items in this range.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 12 }}>
                Tip: Use the filter to quickly find a product name, cashier, customer, or receipt number.
              </p>
            </div>
	          </>
	        ) : null}

        <div className="card col-12">
          <div className="card-header">
            <h3>Stock Take Sessions (Physical Count)</h3>
            <button className="btn primary" type="button" onClick={openCreateSession} disabled={!isAdmin}>
              New Session
            </button>
          </div>

          {sessionsError ? <div className="banner" style={{ marginBottom: 12 }}>{sessionsError}</div> : null}

          {!isAdmin ? <div className="banner">Admin access required to manage stocktake sessions.</div> : null}

          <div className="table-wrap" aria-label="Stocktake sessions">
            <table className="table table-plain table-wide">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Range</th>
                  <th>Counted</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions === null ? (
                  <tr>
                    <td colSpan={6}>Loading sessions...</td>
                  </tr>
                ) : visibleSessions.length > 0 ? (
                  visibleSessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong style={{ letterSpacing: -0.2 }}>{s.name}</strong>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>#{s.id}</div>
                      </td>
                      <td>
                        <span className={`badge ${s.status === "closed" ? "ok" : "warn"}`}>{s.status}</span>
                      </td>
                      <td>{s.createdAt ? formatDateTime(s.createdAt) : "-"}</td>
                      <td>
                        {s.fromAt ? String(s.fromAt).slice(0, 10) : "-"}
                        {"  "}to{"  "}
                        {s.toAt ? String(s.toAt).slice(0, 10) : "-"}
                      </td>
                      <td>
                        {Number(s.countedCount || 0).toLocaleString()} / {Number(s.itemsCount || 0).toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn" type="button" onClick={() => openSession(s.id)} disabled={!isAdmin}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No sessions yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 12 }}>
            Tip: Create a session, enter physical counts, then "Apply & Close" to sync inventory to the counted stock.
          </p>
        </div>

        <div className="card col-12">
          <div className="card-header">
            <h3>Shifts / Cash-up</h3>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              Last 200 shifts
            </div>
          </div>

          {shiftsError ? <div className="banner" style={{ marginBottom: 12 }}>{shiftsError}</div> : null}

          <div className="table-wrap" aria-label="Shifts">
            <table className="table table-plain table-wide">
              <thead>
                <tr>
                  <th>Shift</th>
                  <th>Cashier</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>Sales</th>
                  <th>Expected</th>
                  <th>Closing</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {visibleShifts === null ? (
                  <tr>
                    <td colSpan={8}>Loading shifts...</td>
                  </tr>
                ) : visibleShifts.length > 0 ? (
                  visibleShifts.slice(0, 20).map((sh) => (
                    <tr key={sh.id}>
                      <td>#{sh.id}</td>
                      <td>{sh.cashierName || sh.cashierId || "-"}</td>
                      <td>{sh.openedAt ? formatDateTime(sh.openedAt) : "-"}</td>
                      <td>{sh.closedAt ? formatDateTime(sh.closedAt) : <span className="badge warn">open</span>}</td>
                      <td>{formatCurrency(sh.salesTotal || 0)}</td>
                      <td>{formatCurrency(sh.expectedCash || 0)}</td>
                      <td>{sh.closingCash == null ? "-" : formatCurrency(sh.closingCash)}</td>
                      <td
                        style={{
                          fontWeight: 900,
                          color: Number(sh.variance || 0) < 0 ? "var(--danger)" : "var(--ok)",
                        }}
                      >
                        {sh.variance == null ? "-" : formatCurrency(sh.variance)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>No shifts yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
	      </div>

      <Modal
        open={newSessionOpen}
        title="New Stocktake Session"
        subtitle={`Range: ${fromDate} to ${toDate}`}
        onClose={() => setNewSessionOpen(false)}
      >
        {newSessionError ? <div className="banner" style={{ marginBottom: 12 }}>{newSessionError}</div> : null}

        <div className="field">
          <label>Session Name</label>
          <input
            className="input"
            value={newSessionForm.name}
            onChange={(e) => setNewSessionForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. End of Month Count"
            autoFocus
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Note (optional)</label>
          <input
            className="input"
            value={newSessionForm.note}
            onChange={(e) => setNewSessionForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Who counted, notes, etc."
          />
        </div>

        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={() => setNewSessionOpen(false)} disabled={newSessionSaving}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={createSession} disabled={newSessionSaving}>
            {newSessionSaving ? "Creating..." : "Create Session"}
          </button>
        </div>
      </Modal>

      <Modal
        open={sessionModalOpen}
        title={activeSession?.name || "Stocktake Session"}
        subtitle={activeSession?.id ? `Session #${activeSession.id}` : "Enter physical counts and reconcile inventory"}
        onClose={() => setSessionModalOpen(false)}
      >
        {sessionError ? <div className="banner" style={{ marginBottom: 12 }}>{sessionError}</div> : null}

        {!activeSession ? (
          <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Loading session...</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                Status: <strong>{activeSession.status}</strong>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                Range:{" "}
                <strong>
                  {activeSession.fromAt ? String(activeSession.fromAt).slice(0, 10) : "-"} to{" "}
                  {activeSession.toAt ? String(activeSession.toAt).slice(0, 10) : "-"}
                </strong>
              </div>
            </div>

            <div className="field-row" style={{ marginBottom: 12 }}>
              <div className="field" style={{ flex: "1 1 280px" }}>
                <label>Filter Products</label>
                <input
                  className="input"
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                  placeholder="Type to filter..."
                />
              </div>
            </div>

            <div className="table-wrap" aria-label="Session counts">
              <table className="table table-plain table-wide">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Expected</th>
                    <th>Counted</th>
                    <th>Variance</th>
                    <th>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeSession.items || [])
                    .filter((it) => {
                      const q = String(sessionFilter || "").trim().toLowerCase();
                      if (!q) return true;
                      return (
                        String(it.productName || "").toLowerCase().includes(q) ||
                        String(it.productId || "").toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 80)
                    .map((it) => {
                      const counted = it.countedStock == null ? "" : String(it.countedStock);
                      const variance =
                        it.countedStock == null ? null : Number(it.countedStock) - Number(it.expectedStock || 0);

                      return (
                        <tr key={it.productId}>
                          <td>
                            <strong style={{ letterSpacing: -0.2 }}>{it.productName}</strong>
                            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>#{it.productId}</div>
                          </td>
                          <td>{Number(it.expectedStock || 0).toLocaleString()}</td>
                          <td>
                            {activeSession.status === "closed" ? (
                              it.countedStock == null ? "-" : Number(it.countedStock).toLocaleString()
                            ) : (
                              <input
                                className="input sm"
                                style={{ width: 120 }}
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                value={counted}
                                onChange={(e) => updateCountedStockLocal(it.productId, e.target.value)}
                              />
                            )}
                          </td>
                          <td style={{ fontWeight: 900, color: variance != null && variance < 0 ? "var(--danger)" : "var(--ok)" }}>
                            {variance == null ? "-" : variance.toLocaleString()}
                          </td>
                          <td>{it.currentStock == null ? "-" : Number(it.currentStock).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 12 }}>
              Showing up to 80 items. Use the filter to find a product fast.
            </p>

            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={() => setSessionModalOpen(false)} disabled={sessionBusy}>
                Close
              </button>
              <button className="btn" type="button" onClick={saveSessionCounts} disabled={sessionBusy || activeSession.status === "closed"}>
                {sessionBusy ? "Saving..." : "Save Counts"}
              </button>
              <button className="btn primary" type="button" onClick={closeSession} disabled={sessionBusy || activeSession.status === "closed"}>
                {sessionBusy ? "Applying..." : "Apply & Close"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
