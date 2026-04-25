import { useEffect, useMemo, useState } from "react";
import { createProduct, deleteProduct, listProducts, updateProduct } from "../api/products.js";
import { CheckIcon, PencilIcon, TrashIcon, XIcon } from "./icons/Icons.jsx";
import Modal from "./ui/Modal.jsx";

const LOW_STOCK_THRESHOLD = 5;

function getStatus(stockRaw) {
  const stock = Number(stockRaw ?? 0);
  if (stock <= 0) return { key: "out_of_stock", label: "Out of Stock", tone: "danger" };
  if (stock <= LOW_STOCK_THRESHOLD) return { key: "low_stock", label: "Low Stock", tone: "warn" };
  return { key: "in_stock", label: "In Stock", tone: "ok" };
}

function formatCurrency(amountRaw) {
  const amount = Number(amountRaw ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function normalizeProducts(data) {
  if (!Array.isArray(data)) return [];
  return data.map((p) => ({
    id: p.id,
    name: p.name ?? "",
    price: Number(p.price ?? 0),
    costPrice: Number(p.costPrice ?? p.cost_price ?? 0),
    stock: Number(p.stock ?? 0),
  }));
}

export default function ProductTable({
  search,
  statusFilter,
  addProductOpen,
  onOpenAddProduct,
  onCloseAddProduct,
  refreshKey,
  canManage = false,
}) {
  const [products, setProducts] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({ name: "", price: "", costPrice: "", stock: "" });

  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: "", price: "", costPrice: "", stock: "" });
  const [rowError, setRowError] = useState("");
  const [rowBusyId, setRowBusyId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    listProducts({ signal: controller.signal })
      .then((data) => {
        setLoadError("");
        setProducts(normalizeProducts(data));
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setLoadError(err?.message || "Failed to load products");
        setProducts([]);
      });

    return () => controller.abort();
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const q = String(search || "").trim().toLowerCase();

    return products
      .filter((p) => {
        if (!q) return true;
        return p.name.toLowerCase().includes(q);
      })
      .filter((p) => {
        if (!statusFilter || statusFilter === "all") return true;
        return getStatus(p.stock).key === statusFilter;
      });
  }, [products, search, statusFilter]);

  const beginEdit = (p) => {
    if (!canManage) return;
    setRowError("");
    setEditingId(p.id);
    setEditDraft({
      name: p.name ?? "",
      price: String(p.price ?? ""),
      costPrice: String(p.costPrice ?? ""),
      stock: String(p.stock ?? ""),
    });
  };

  const cancelEdit = () => {
    setRowError("");
    setEditingId(null);
    setEditDraft({ name: "", price: "", costPrice: "", stock: "" });
  };

  const saveEdit = (id) => {
    if (!canManage) return;
    setRowError("");

    const name = editDraft.name.trim();
    const priceRaw = String(editDraft.price ?? "").trim();
    const costRaw = String(editDraft.costPrice ?? "").trim();
    const stockRaw = String(editDraft.stock ?? "").trim();
    const price = Number(priceRaw);
    const costPrice = Number(costRaw);
    const stock = Number(stockRaw);

    if (!name) {
      setRowError("Name is required.");
      return;
    }
    if (!priceRaw) {
      setRowError("Price is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setRowError("Price must be a valid number.");
      return;
    }
    if (!costRaw) {
      setRowError("Cost price is required.");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setRowError("Cost price must be a valid number.");
      return;
    }
    if (!stockRaw) {
      setRowError("Stock is required.");
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      setRowError("Stock must be a valid number.");
      return;
    }

    setRowBusyId(id);

    updateProduct(id, { name, price, costPrice, stock })
      .then((updated) => {
        const next =
          updated && typeof updated === "object"
            ? updated
            : { id, name, price, costPrice, stock };
        setProducts((prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((p) => (p.id === id ? { ...p, ...next } : p));
        });
        cancelEdit();
      })
      .catch((err) => setRowError(err?.message || "Failed to update product"))
      .finally(() => setRowBusyId(null));
  };

  const removeProduct = (id) => {
    if (!canManage) return;
    setRowError("");
    if (!window.confirm("Delete this product?")) return;

    setRowBusyId(id);
    deleteProduct(id)
      .then(() => {
        setProducts((prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.filter((p) => p.id !== id);
        });
        if (editingId === id) cancelEdit();
      })
      .catch((err) => setRowError(err?.message || "Failed to delete product"))
      .finally(() => setRowBusyId(null));
  };

  const submitCreate = (e) => {
    e.preventDefault();
    if (!canManage) return;
    setCreateError("");

    const name = createForm.name.trim();
    const priceRaw = String(createForm.price ?? "").trim();
    const costRaw = String(createForm.costPrice ?? "").trim();
    const stockRaw = String(createForm.stock ?? "").trim();
    const price = Number(priceRaw);
    const costPrice = Number(costRaw);
    const stock = Number(stockRaw);

    if (!name) {
      setCreateError("Product name is required.");
      return;
    }
    if (!priceRaw) {
      setCreateError("Price is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCreateError("Price must be a valid number.");
      return;
    }
    if (!costRaw) {
      setCreateError("Cost price is required.");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setCreateError("Cost price must be a valid number.");
      return;
    }
    if (!stockRaw) {
      setCreateError("Stock quantity is required.");
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      setCreateError("Stock must be a valid number.");
      return;
    }

    setCreating(true);
    createProduct({ name, price, costPrice, stock })
      .then((created) => {
        const next =
          created && typeof created === "object"
            ? {
                id: created.id,
                name: created.name,
                price: Number(created.price),
                costPrice: Number(created.costPrice ?? created.cost_price ?? costPrice),
                stock: Number(created.stock),
              }
            : { id: undefined, name, price, costPrice, stock };

        setProducts((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return [next, ...list];
        });

        setCreateForm({ name: "", price: "", costPrice: "", stock: "" });
        onCloseAddProduct?.();
      })
      .catch((err) => setCreateError(err?.message || "Failed to create product"))
      .finally(() => setCreating(false));
  };

  const colCount = canManage ? 6 : 4;

  return (
    <div>
      {loadError ? <div className="banner" style={{ marginBottom: 12 }}>{loadError}</div> : null}
      {rowError ? <div className="banner" style={{ marginBottom: 12 }}>{rowError}</div> : null}

      <div className="table-wrap" aria-label="Products table">
        <table className="table table-wide">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Product</th>
              <th>Price</th>
              {canManage ? <th>Cost</th> : null}
              <th>Stock</th>
              <th>Status</th>
              {canManage ? <th style={{ width: 140 }}>Actions</th> : null}
            </tr>
          </thead>

          <tbody>
            {products === null ? (
              <tr>
                <td colSpan={colCount}>Loading products...</td>
              </tr>
            ) : filtered.length > 0 ? (
              filtered.map((p) => {
                const isEditing = canManage && editingId === p.id;
                const status = getStatus(p.stock);
                const busy = rowBusyId === p.id;

                return (
                  <tr key={p.id ?? `${p.name}-${p.price}`}>
                    <td>
                      {isEditing ? (
                        <input
                          className="input sm"
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          placeholder="Product name"
                        />
                      ) : (
                        <strong style={{ letterSpacing: -0.2 }}>{p.name}</strong>
                      )}
                    </td>

                  <td>
                    {isEditing ? (
                      <input
                        className="input sm"
                        type="number"
                        inputMode="decimal"
                        value={editDraft.price}
                        onChange={(e) => setEditDraft((d) => ({ ...d, price: e.target.value }))}
                        min="0"
                        step="0.01"
                      />
                    ) : (
                      formatCurrency(p.price)
                    )}
                  </td>

                  {canManage ? (
                    <td>
                      {isEditing ? (
                        <input
                          className="input sm"
                          type="number"
                          inputMode="decimal"
                          value={editDraft.costPrice}
                          onChange={(e) => setEditDraft((d) => ({ ...d, costPrice: e.target.value }))}
                          min="0"
                          step="0.01"
                        />
                      ) : (
                        formatCurrency(p.costPrice)
                      )}
                    </td>
                  ) : null}

                  <td>
                    {isEditing ? (
                      <input
                        className="input sm"
                        type="number"
                        inputMode="numeric"
                        value={editDraft.stock}
                        onChange={(e) => setEditDraft((d) => ({ ...d, stock: e.target.value }))}
                        min="0"
                        step="1"
                      />
                    ) : (
                      p.stock
                    )}
                  </td>

                  <td>
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                  </td>

                  {canManage ? (
                    <td>
                      {isEditing ? (
                        <span className="row-actions">
                          <button
                            className="icon-btn sm"
                            type="button"
                            onClick={() => saveEdit(p.id)}
                            aria-label="Save"
                            disabled={busy}
                            title="Save"
                          >
                            <CheckIcon className="nav-icon" />
                          </button>
                          <button
                            className="icon-btn sm"
                            type="button"
                            onClick={cancelEdit}
                            aria-label="Cancel"
                            disabled={busy}
                            title="Cancel"
                          >
                            <XIcon className="nav-icon" />
                          </button>
                        </span>
                      ) : (
                        <span className="row-actions">
                          <button
                            className="icon-btn sm"
                            type="button"
                            onClick={() => beginEdit(p)}
                            aria-label="Edit"
                            disabled={busy}
                            title="Edit"
                          >
                            <PencilIcon className="nav-icon" />
                          </button>
                          <button
                            className="icon-btn sm"
                            type="button"
                            onClick={() => removeProduct(p.id)}
                            aria-label="Delete"
                            disabled={busy}
                            title="Delete"
                          >
                            <TrashIcon className="nav-icon" />
                          </button>
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
              })
            ) : (
              <tr>
                <td colSpan={colCount}>
                  No products found.
                  {canManage ? (
                    <>
                      {" "}
                      <button className="btn ghost" type="button" onClick={onOpenAddProduct}>
                        Add your first product
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={canManage && !!addProductOpen}
        title="Add Product"
        subtitle="Create a new item and it will appear instantly in your inventory."
        onClose={onCloseAddProduct}
      >
        <form onSubmit={submitCreate}>
          {createError ? <div className="banner" style={{ marginBottom: 12 }}>{createError}</div> : null}

          <div className="field-row">
            <div className="field" style={{ flex: "1 1 260px" }}>
              <label>Product Name</label>
              <input
                className="input"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Satin Blouse"
                autoFocus
                required
              />
            </div>
            <div className="field" style={{ flex: "0 0 160px" }}>
              <label>Price</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={createForm.price}
                onChange={(e) => setCreateForm((f) => ({ ...f, price: e.target.value }))}
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
            <div className="field" style={{ flex: "0 0 160px" }}>
              <label>Cost Price</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={createForm.costPrice}
                onChange={(e) => setCreateForm((f) => ({ ...f, costPrice: e.target.value }))}
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
            <div className="field" style={{ flex: "0 0 160px" }}>
              <label>Stock Qty</label>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={createForm.stock}
                onChange={(e) => setCreateForm((f) => ({ ...f, stock: e.target.value }))}
                min="0"
                step="1"
                placeholder="0"
                required
              />
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={onCloseAddProduct} disabled={creating}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={creating}>
              {creating ? "Saving..." : "Save Product"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
