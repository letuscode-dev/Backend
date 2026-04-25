import { useEffect, useMemo, useState } from "react";
import { PlusIcon } from "../components/icons/Icons.jsx";
import ProductTable from "../components/ProductTable.jsx";
import Modal from "../components/ui/Modal.jsx";
import { listProducts } from "../api/products.js";
import { createPurchase, getPurchaseById, listPurchases, receivePurchase } from "../api/purchases.js";

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

export default function InventoryPage({
  search,
  onSearchChange,
  addProductOpen,
  onOpenAddProduct,
  onCloseAddProduct,
  me,
}) {
  const [statusFilter, setStatusFilter] = useState("low_stock");
  const [productsRefreshKey, setProductsRefreshKey] = useState(0);

  const isAdmin = useMemo(() => String(me?.role || "").toLowerCase() === "admin", [me]);

  const [purchases, setPurchases] = useState(null);
  const [purchasesError, setPurchasesError] = useState("");
  const [purchasesBusyId, setPurchasesBusyId] = useState(null);
  const visiblePurchases = isAdmin ? purchases : [];

  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ supplierName: "", note: "", lines: [{ productId: "", qty: 1, unitCost: "" }] });
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseReceiving, setPurchaseReceiving] = useState(false);

  const [purchaseViewOpen, setPurchaseViewOpen] = useState(false);
  const [purchaseView, setPurchaseView] = useState(null);
  const [purchaseViewError, setPurchaseViewError] = useState("");

  const [productsForReceiving, setProductsForReceiving] = useState(null);
  const [productsForReceivingError, setProductsForReceivingError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();

    listPurchases({ signal: controller.signal })
      .then((data) => {
        setPurchasesError("");
        setPurchases(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setPurchasesError(err?.message || "Failed to load purchases");
        setPurchases([]);
      });

    return () => controller.abort();
  }, [isAdmin]);

  const openNewPurchase = () => {
    setPurchaseError("");
    setPurchaseForm({ supplierName: "", note: "", lines: [{ productId: "", qty: 1, unitCost: "" }] });
    setPurchaseModalOpen(true);

    if (productsForReceiving !== null) return;
    const controller = new AbortController();
    listProducts({ signal: controller.signal })
      .then((data) => {
        setProductsForReceivingError("");
        setProductsForReceiving(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setProductsForReceivingError(err?.message || "Failed to load products for receiving");
        setProductsForReceiving([]);
      });
    return () => controller.abort();
  };

  const addPurchaseLine = () => {
    setPurchaseForm((f) => ({
      ...f,
      lines: [...(Array.isArray(f.lines) ? f.lines : []), { productId: "", qty: 1, unitCost: "" }],
    }));
  };

  const removePurchaseLine = (idx) => {
    setPurchaseForm((f) => {
      const lines = Array.isArray(f.lines) ? [...f.lines] : [];
      lines.splice(idx, 1);
      return { ...f, lines: lines.length ? lines : [{ productId: "", qty: 1, unitCost: "" }] };
    });
  };

  const savePurchase = async ({ receiveNow }) => {
    setPurchaseError("");
    if (!isAdmin) {
      setPurchaseError("Admin access required to create purchases.");
      return;
    }

    const supplierName = purchaseForm.supplierName.trim() || null;
    const note = purchaseForm.note.trim() || null;
    const lines = Array.isArray(purchaseForm.lines) ? purchaseForm.lines : [];

    const items = lines
      .map((l) => ({
        productId: l.productId ? Number(l.productId) : null,
        qty: Number(l.qty),
        unitCost: l.unitCost === "" ? null : Number(l.unitCost),
      }))
      .filter((it) => it.productId && Number.isFinite(it.qty) && it.qty > 0 && it.unitCost != null && Number.isFinite(it.unitCost) && it.unitCost >= 0);

    if (items.length === 0) {
      setPurchaseError("Add at least one valid line item (product, qty, unit cost).");
      return;
    }

    setPurchaseSaving(true);
    try {
      const created = await createPurchase({
        supplierName,
        note,
        items,
      });

      if (receiveNow) {
        setPurchaseReceiving(true);
        await receivePurchase(created.id, {});
      }

      // Refresh purchase list + products list.
      const refreshed = await listPurchases();
      setPurchases(Array.isArray(refreshed) ? refreshed : []);
      setProductsRefreshKey((k) => k + 1);

      setPurchaseModalOpen(false);
    } catch (err) {
      setPurchaseError(err?.message || "Failed to save purchase");
    } finally {
      setPurchaseReceiving(false);
      setPurchaseSaving(false);
    }
  };

  const viewPurchase = (id) => {
    setPurchaseViewError("");
    if (!isAdmin) return;

    setPurchaseViewOpen(true);
    setPurchaseView(null);

    const controller = new AbortController();
    getPurchaseById(id, { signal: controller.signal })
      .then((data) => setPurchaseView(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setPurchaseViewError(err?.message || "Failed to load purchase");
      });

    return () => controller.abort();
  };

  const doReceive = (id) => {
    setPurchasesError("");
    if (!isAdmin) return;
    if (!window.confirm("Receive this purchase? This will increase stock and update cost price.")) return;

    setPurchasesBusyId(id);
    receivePurchase(id, {})
      .then(() => listPurchases())
      .then((data) => {
        setPurchases(Array.isArray(data) ? data : []);
        setProductsRefreshKey((k) => k + 1);
      })
      .catch((err) => setPurchasesError(err?.message || "Failed to receive purchase"))
      .finally(() => setPurchasesBusyId(null));
  };

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Inventory</h1>
          <p>Stay ahead of low stock before it becomes lost sales.</p>
        </div>

        <button className="btn primary" type="button" onClick={onOpenAddProduct}>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            <PlusIcon className="nav-icon" />
            Add Product
          </span>
        </button>
      </div>

      <div className="field-row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 260, flex: "1 1 320px" }}>
          <label>Search</label>
          <input
            className="input"
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Search by name..."
          />
        </div>

        <div className="field" style={{ minWidth: 220, flex: "0 0 220px" }}>
          <label>Focus</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All inventory</option>
            <option value="in_stock">In stock</option>
            <option value="low_stock">Low stock</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
        </div>
      </div>

      <div className="grid">
        <div className="card col-12">
          <div className="card-header">
            <h3>Purchases / Receiving</h3>
            {isAdmin ? (
              <button className="btn primary" type="button" onClick={openNewPurchase}>
                New Purchase
              </button>
            ) : null}
          </div>

          {!isAdmin ? (
            <div className="banner" style={{ marginTop: 10 }}>
              Admin access required to manage purchases and receiving.
            </div>
          ) : null}

          <div className="field-row" style={{ marginTop: 10, marginBottom: 12 }}>
            <div className="field" style={{ flex: "1 1 280px" }}>
              <label>Search Purchases</label>
              <input
                className="input"
                value={search}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder="Supplier, status, id..."
              />
            </div>
          </div>

          {purchasesError ? <div className="banner" style={{ marginBottom: 12 }}>{purchasesError}</div> : null}

          <div className="table-wrap" aria-label="Purchases table">
            <table className="table table-plain table-wide">
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Received</th>
                  <th>Total Cost</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visiblePurchases === null ? (
                  <tr>
                    <td colSpan={7}>Loading purchases...</td>
                  </tr>
                ) : visiblePurchases.length > 0 ? (
                  visiblePurchases
                    .filter((p) => {
                      const q = String(search || "").trim().toLowerCase();
                      if (!q) return true;
                      return (
                        String(p.id).toLowerCase().includes(q) ||
                        String(p.supplierName || "").toLowerCase().includes(q) ||
                        String(p.status || "").toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 20)
                    .map((p) => (
                      <tr key={p.id}>
                        <td>#{p.id}</td>
                        <td>{p.supplierName || "-"}</td>
                        <td>
                          <span className={`badge ${p.status === "received" ? "ok" : p.status === "draft" ? "warn" : ""}`}>
                            {p.status}
                          </span>
                        </td>
                        <td>{p.createdAt ? formatDateTime(p.createdAt) : "-"}</td>
                        <td>{p.receivedAt ? formatDateTime(p.receivedAt) : "-"}</td>
                        <td>{formatCurrency(p.totalCost || 0)}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className="row-actions">
                            <button className="btn" type="button" onClick={() => viewPurchase(p.id)} disabled={!isAdmin}>
                              View
                            </button>
                            {p.status === "draft" ? (
                              <button
                                className="btn primary"
                                type="button"
                                onClick={() => doReceive(p.id)}
                                disabled={!isAdmin || purchasesBusyId === p.id}
                              >
                                {purchasesBusyId === p.id ? "Receiving..." : "Receive"}
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td colSpan={7}>No purchases yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card col-12">
          <div className="card-header">
            <h3>Inventory</h3>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Manage stock and pricing</div>
          </div>
          <ProductTable
            search={search}
            statusFilter={statusFilter}
            addProductOpen={addProductOpen}
            onOpenAddProduct={onOpenAddProduct}
            onCloseAddProduct={onCloseAddProduct}
            refreshKey={productsRefreshKey}
            canManage={isAdmin}
          />
        </div>
      </div>

      <Modal
        open={purchaseModalOpen}
        title="New Purchase / Receiving"
        subtitle="Record stock received from suppliers and update average cost price."
        onClose={() => setPurchaseModalOpen(false)}
      >
        {purchaseError ? <div className="banner" style={{ marginBottom: 12 }}>{purchaseError}</div> : null}
        {productsForReceivingError ? <div className="banner" style={{ marginBottom: 12 }}>{productsForReceivingError}</div> : null}

        <div className="field-row">
          <div className="field" style={{ flex: "1 1 240px" }}>
            <label>Supplier (optional)</label>
            <input
              className="input"
              value={purchaseForm.supplierName}
              onChange={(e) => setPurchaseForm((f) => ({ ...f, supplierName: e.target.value }))}
              placeholder="e.g. Denim Co."
              autoFocus
            />
          </div>
          <div className="field" style={{ flex: "1 1 320px" }}>
            <label>Note (optional)</label>
            <input
              className="input"
              value={purchaseForm.note}
              onChange={(e) => setPurchaseForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Invoice number, delivery note, etc."
            />
          </div>
        </div>

        <div className="divider" />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900 }}>Line Items</div>
          <button className="btn ghost" type="button" onClick={addPurchaseLine}>
            Add Line
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(purchaseForm.lines || []).map((l, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 90px 120px auto", gap: 10, alignItems: "end" }}>
              <div className="field">
                <label>Product</label>
                <select
                  className="input sm"
                  value={l.productId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPurchaseForm((f) => {
                      const lines = Array.isArray(f.lines) ? [...f.lines] : [];
                      lines[idx] = { ...lines[idx], productId: next };
                      return { ...f, lines };
                    });
                  }}
                >
                  <option value="">(select)</option>
                  {(productsForReceiving || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Qty</label>
                <input
                  className="input sm"
                  type="number"
                  min="1"
                  step="1"
                  value={l.qty}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPurchaseForm((f) => {
                      const lines = Array.isArray(f.lines) ? [...f.lines] : [];
                      lines[idx] = { ...lines[idx], qty: next };
                      return { ...f, lines };
                    });
                  }}
                />
              </div>
              <div className="field">
                <label>Unit Cost</label>
                <input
                  className="input sm"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={l.unitCost}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPurchaseForm((f) => {
                      const lines = Array.isArray(f.lines) ? [...f.lines] : [];
                      lines[idx] = { ...lines[idx], unitCost: next };
                      return { ...f, lines };
                    });
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn" type="button" onClick={() => removePurchaseLine(idx)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={() => setPurchaseModalOpen(false)} disabled={purchaseSaving || purchaseReceiving}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => savePurchase({ receiveNow: false })} disabled={purchaseSaving || purchaseReceiving}>
            {purchaseSaving ? "Saving..." : "Save Draft"}
          </button>
          <button className="btn primary" type="button" onClick={() => savePurchase({ receiveNow: true })} disabled={purchaseSaving || purchaseReceiving}>
            {purchaseReceiving ? "Receiving..." : "Save & Receive"}
          </button>
        </div>
      </Modal>

      <Modal
        open={purchaseViewOpen}
        title={purchaseView?.id ? `Purchase #${purchaseView.id}` : "Purchase"}
        subtitle={purchaseView?.supplierName ? `Supplier: ${purchaseView.supplierName}` : "Purchase details"}
        onClose={() => setPurchaseViewOpen(false)}
      >
        {purchaseViewError ? <div className="banner" style={{ marginBottom: 12 }}>{purchaseViewError}</div> : null}
        {!purchaseView ? (
          <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Loading...</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                Status: <strong>{purchaseView.status}</strong>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                Created: <strong>{purchaseView.createdAt ? formatDateTime(purchaseView.createdAt) : "-"}</strong>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                Received: <strong>{purchaseView.receivedAt ? formatDateTime(purchaseView.receivedAt) : "-"}</strong>
              </div>
            </div>

            <div className="table-wrap" aria-label="Purchase items">
              <table className="table table-plain">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit Cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(purchaseView.items || []).map((it) => (
                    <tr key={it.id || `${it.productId}-${it.productName}`}>
                      <td>{it.productName}</td>
                      <td>{it.qty}</td>
                      <td>{formatCurrency(it.unitCost)}</td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
