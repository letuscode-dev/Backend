import { useEffect, useMemo, useState } from "react";
import { listProducts } from "../api/products.js";
import { createSale, deleteSale, getSaleById, listSales, updateSale } from "../api/sales.js";
import { closeShift, getOpenShift, openShift } from "../api/shifts.js";
import { TrashIcon } from "../components/icons/Icons.jsx";
import Modal from "../components/ui/Modal.jsx";
import {
  BT_PRINTER_ADDRESS_KEY,
  connectPrinter,
  disconnectPrinter,
  isNativeAndroid,
  printText,
  requestBluetoothPermission,
} from "../native/bluetoothEscpos.js";

function toMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function formatCurrency(amount) {
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

function formatDateTimeParts(isoLike) {
  try {
    const d = new Date(isoLike);
    const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
    return { date, time };
  } catch {
    return { date: String(isoLike), time: "" };
  }
}

function buildReceiptText(receipt) {
  if (!receipt) return "";

  const lines = [];
  const push = (s = "") => lines.push(String(s));

  push("T-ONE");
  push("Receipt");
  push(receipt?.createdAt ? `Date: ${formatDateTime(receipt.createdAt)}` : "");
  push(receipt?.cashier?.name ? `Cashier: ${receipt.cashier.name}` : "");
  push(`Customer: ${receipt?.customerName || "Walk-in"}`);
  push(`Sale: #${receipt?.id || "-"}`);
  push("--------------------------------");

  for (const it of receipt?.items || []) {
    const qty = Number(it.qty || 0);
    const unit = Number(it.unitPrice || 0);
    const lineTotal = Number(it.lineTotal ?? unit * qty);
    push(String(it.name || "Item"));
    push(`  ${qty} x ${formatCurrency(unit)} = ${formatCurrency(lineTotal)}`);
  }

  push("--------------------------------");
  push(`TOTAL: ${formatCurrency(Number(receipt?.total || 0))}`);
  push("");
  push("Thank you for shopping with us");

  return lines.filter((l) => l !== null && l !== undefined).join("\n").trim() + "\n";
}

export default function SalesPage({ search, me }) {
  const androidNative = isNativeAndroid();
  const [products, setProducts] = useState(null);
  const [sales, setSales] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [salesFrom, setSalesFrom] = useState("");
  const [salesTo, setSalesTo] = useState("");
  const [salesLimit, setSalesLimit] = useState("200");
  const [salesLoading, setSalesLoading] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [cart, setCart] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [btPrintBusy, setBtPrintBusy] = useState(false);
  const [btPrintError, setBtPrintError] = useState("");

  const [openShiftData, setOpenShiftData] = useState(null);
  const [shiftError, setShiftError] = useState("");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [shiftBusy, setShiftBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaleId, setEditSaleId] = useState(null);
  const [editCreatedAt, setEditCreatedAt] = useState(null);
  const [editCashierName, setEditCashierName] = useState("");
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editLines, setEditLines] = useState([]);
  const [editOriginalQtyByPid, setEditOriginalQtyByPid] = useState({});
  const [editProductQuery, setEditProductQuery] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      listProducts({ signal: controller.signal }),
      listSales({ signal: controller.signal }),
    ])
      .then(([productsData, salesData]) => {
        setLoadError("");
        setProducts(Array.isArray(productsData) ? productsData : []);
        setSales(Array.isArray(salesData) ? salesData : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setLoadError(err?.message || "Failed to load POS data");
        setProducts([]);
        setSales([]);
      });

    return () => controller.abort();
  }, []);

  const reloadSales = ({ from = salesFrom, to = salesTo, limit = salesLimit } = {}) => {
    setSalesLoading(true);
    setLoadError("");

    const controller = new AbortController();
    listSales({
      from: from || undefined,
      to: to || undefined,
      limit: limit || undefined,
      signal: controller.signal,
    })
      .then((salesData) => {
        setSales(Array.isArray(salesData) ? salesData : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setLoadError(err?.message || "Failed to load sales");
        setSales([]);
      })
      .finally(() => setSalesLoading(false));

    return () => controller.abort();
  };

  const resetSalesFilters = () => {
    setSalesFrom("");
    setSalesTo("");
    setSalesLimit("200");
    reloadSales({ from: "", to: "", limit: "200" });
  };

  const productMap = useMemo(() => {
    const map = new Map();
    (products || []).forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const isAdmin = String(me?.role || "").toLowerCase() === "admin";

  const canDiscount = useMemo(() => {
    if (!me) return false;
    if (String(me.role) === "admin") return true;
    return Boolean(me.canDiscount);
  }, [me]);

  const receiptText = useMemo(() => buildReceiptText(receipt), [receipt]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((acc, it) => {
      const unitPrice = toMoney(it.unitPriceInput);
      if (unitPrice == null) return acc;
      return acc + Number(it.qty) * unitPrice;
    }, 0);
  }, [cart]);

  const editSubtotal = useMemo(() => {
    return editLines.reduce((acc, it) => {
      const unitPrice = toMoney(it.unitPriceInput);
      if (unitPrice == null) return acc;
      return acc + Number(it.qty) * unitPrice;
    }, 0);
  }, [editLines]);

  const salesTotal = useMemo(() => {
    if (!Array.isArray(sales)) return 0;
    return sales.reduce((acc, s) => acc + Number(s.total || 0), 0);
  }, [sales]);

  const productResults = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const q = String(search || "").trim().toLowerCase();
    return products
      .filter((p) => {
        if (!q) return true;
        return String(p.name || "").toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [products, search]);

  const editProductResults = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const q = String(editProductQuery || "").trim().toLowerCase();
    if (!q) return [];

    return products
      .filter((p) => String(p.name || "").toLowerCase().includes(q))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .slice(0, 10);
  }, [products, editProductQuery]);

  const filteredSales = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!Array.isArray(sales)) return [];
    if (!q) return sales;

    return sales.filter((s) => {
      return (
        String(s.id).toLowerCase().includes(q) ||
        String(s.customerName || "").toLowerCase().includes(q) ||
        String(s.cashierName || "").toLowerCase().includes(q) ||
        String(s.createdAt || "").toLowerCase().includes(q)
      );
    });
  }, [search, sales]);

  const addToCart = (p) => {
    setSubmitError("");

    const stock = Number(p.stock ?? 0);
    if (stock <= 0) return;
    const basePrice = Number(p.price ?? 0);

    setCart((prev) => {
      const next = [...prev];
      const idx = next.findIndex((it) => it.productId === p.id);
      if (idx >= 0) {
        const cur = next[idx];
        const nextQty = Math.min(stock, Number(cur.qty) + 1);
        next[idx] = { ...cur, qty: nextQty, stock };
        return next;
      }
      next.push({
        productId: p.id,
        name: p.name,
        basePrice,
        unitPriceInput: String(basePrice),
        qty: 1,
        stock,
      });
      return next;
    });
  };

  const updateQty = (productId, nextQty) => {
    setCart((prev) => {
      const next = prev.map((it) => ({ ...it }));
      const idx = next.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;
      const it = next[idx];
      const stock = Number(productMap.get(productId)?.stock ?? it.stock ?? 0);
      const qty = Math.max(1, Math.min(stock, Number(nextQty)));
      next[idx] = { ...it, qty, stock };
      return next;
    });
  };

  const updateUnitPriceInput = (productId, raw) => {
    setSubmitError("");

    setCart((prev) => {
      const next = prev.map((it) => ({ ...it }));
      const idx = next.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;

      const it = next[idx];
      const basePrice = toMoney(it.basePrice) ?? 0;

      // Keep raw input for smooth typing; clamp on blur.
      if (raw !== "" && raw !== "." && raw !== "0.") {
        const parsed = toMoney(raw);
        if (parsed != null && parsed > basePrice) {
          next[idx] = { ...it, unitPriceInput: String(basePrice) };
          return next;
        }
      }

      next[idx] = { ...it, unitPriceInput: raw };
      return next;
    });
  };

  const clampUnitPrice = (productId) => {
    setCart((prev) => {
      const next = prev.map((it) => ({ ...it }));
      const idx = next.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;

      const it = next[idx];
      const basePrice = toMoney(it.basePrice) ?? 0;
      const parsed = toMoney(it.unitPriceInput);
      const clamped = parsed == null ? basePrice : Math.max(0, Math.min(basePrice, parsed));
      next[idx] = { ...it, unitPriceInput: String(clamped) };
      return next;
    });
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((it) => it.productId !== productId));
  };

  const fetchShift = ({ signal } = {}) => {
    return getOpenShift({ signal })
      .then((data) => {
        setShiftError("");
        setOpenShiftData(data);
        if (!data) {
          setClosingCash("");
          setOpeningFloat("0");
        }
        return data;
      })
      .catch((err) => {
        if (err?.name === "AbortError") return null;
        setShiftError(err?.message || "Failed to load shift");
        setOpenShiftData(null);
        return null;
      });
  };

  const refreshShiftNow = () => {
    setOpenShiftData(undefined);

    const controller = new AbortController();
    fetchShift({ signal: controller.signal });
    return () => controller.abort();
  };

  useEffect(() => {
    const controller = new AbortController();

    setOpenShiftData(undefined);
    fetchShift({ signal: controller.signal });

    return () => controller.abort();
  }, [me?.id]);

  const completeSale = (e) => {
    e.preventDefault();
    setSubmitError("");

    if (cart.length === 0) {
      setSubmitError("Add at least one product to complete a sale.");
      return;
    }

    const items = [];
    for (const it of cart) {
      const baseUnitPrice = toMoney(it.basePrice);
      const unitPrice = toMoney(it.unitPriceInput);

      if (baseUnitPrice == null) {
        setSubmitError(`Invalid base price for "${it.name}".`);
        return;
      }

      if (unitPrice == null) {
        setSubmitError(`Enter a valid price for "${it.name}".`);
        return;
      }

      if (unitPrice > baseUnitPrice) {
        setSubmitError(`Discount price cannot be higher than the product price for "${it.name}".`);
        return;
      }

      const isDiscount = unitPrice < baseUnitPrice;
      if (isDiscount && !canDiscount) {
        setSubmitError("Discount permission required for this cashier. Ask an admin to enable it in Settings / Users.");
        return;
      }

      items.push({
        productId: it.productId,
        qty: it.qty,
        ...(isDiscount ? { unitPrice } : null),
      });
    }

    const payload = {
      customerName: customerName.trim() || null,
      items,
    };

    setSubmitting(true);
    createSale(payload)
      .then((created) => {
        setReceipt(created);
        setReceiptOpen(true);

        // Update products stock locally for instant UI feedback.
        setProducts((prev) => {
          if (!Array.isArray(prev)) return prev;
          const next = prev.map((p) => ({ ...p }));
          created.items.forEach((it) => {
            const idx = next.findIndex((p) => p.id === it.productId);
            if (idx >= 0) {
              next[idx].stock = Math.max(0, Number(next[idx].stock ?? 0) - Number(it.qty ?? 0));
            }
          });
          return next;
        });

        // Add to recent sales list.
        setSales((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return [
            {
              id: created.id,
              customerName: created.customerName,
              subtotal: created.subtotal,
              total: created.total,
              createdAt: created.createdAt,
              cashierId: created.cashier?.id ?? null,
              cashierName: created.cashier?.name ?? "",
              itemsCount: created.items?.length ?? 0,
            },
            ...list,
          ];
        });

        setCart([]);
        setCustomerName("");

        // Shift totals update based on sales; refresh so expected cash updates.
        refreshShiftNow();
      })
      .catch((err) => setSubmitError(err?.message || "Failed to complete sale"))
      .finally(() => setSubmitting(false));
  };

  const openReceiptForSale = (id) => {
    setSubmitError("");

    setSubmitting(true);
    getSaleById(id)
      .then((data) => {
        setReceipt({
          id: data.id,
          createdAt: data.createdAt,
          customerName: data.customerName,
          subtotal: data.subtotal,
          total: data.total,
          cashier: data.cashierName ? { id: data.cashierId, name: data.cashierName } : null,
          items: Array.isArray(data.items)
            ? data.items.map((it) => ({
                productId: it.productId,
                name: it.name,
                qty: Number(it.qty),
                unitPrice: Number(it.unitPrice),
                lineTotal: Number(it.lineTotal),
              }))
            : [],
        });
        setReceiptOpen(true);
      })
      .catch((err) => setSubmitError(err?.message || "Failed to load receipt"))
      .finally(() => setSubmitting(false));
  };

  const closeEditModal = () => {
    setEditOpen(false);
    setEditSaleId(null);
    setEditCreatedAt(null);
    setEditCashierName("");
    setEditCustomerName("");
    setEditLines([]);
    setEditOriginalQtyByPid({});
    setEditProductQuery("");
    setEditError("");
    setEditBusy(false);
  };

  const openEditForSale = (saleId) => {
    if (!isAdmin) return;

    setEditError("");
    setEditBusy(true);
    setEditOpen(true);
    setEditSaleId(saleId);

    getSaleById(saleId)
      .then((data) => {
        const lines = Array.isArray(data.items)
          ? data.items.map((it) => ({
              productId: it.productId,
              name: it.name,
              qty: Number(it.qty) || 1,
              unitPriceInput: String(toMoney(it.unitPrice) ?? 0),
            }))
          : [];

        const originalQty = {};
        lines.forEach((it) => {
          originalQty[it.productId] = Number(it.qty) || 0;
        });

        setEditSaleId(data.id);
        setEditCreatedAt(data.createdAt);
        setEditCashierName(data.cashierName || "");
        setEditCustomerName(data.customerName || "");
        setEditLines(lines);
        setEditOriginalQtyByPid(originalQty);
        setEditProductQuery("");
      })
      .catch((err) => setEditError(err?.message || "Failed to load sale"))
      .finally(() => setEditBusy(false));
  };

  const editRemoveLine = (productId) => {
    setEditLines((prev) => prev.filter((it) => it.productId !== productId));
  };

  const editUpdateQty = (productId, nextQty) => {
    setEditLines((prev) => {
      const idx = prev.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;

      const product = productMap.get(productId);
      if (!product) return prev; // product deleted; backend forbids qty changes.

      const currentStock = Number(product.stock ?? 0);
      const originalQty = Number(editOriginalQtyByPid?.[productId] ?? 0);
      const maxQty = Math.max(0, currentStock + originalQty);

      const parsed = Number.parseInt(String(nextQty), 10);
      const qty = Number.isFinite(parsed) ? parsed : 1;
      const clamped = Math.max(1, Math.min(maxQty || 1, qty));

      const next = prev.map((it) => ({ ...it }));
      next[idx] = { ...next[idx], qty: clamped };
      return next;
    });
  };

  const editUpdateUnitPriceInput = (productId, raw) => {
    setEditLines((prev) => {
      const idx = prev.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;
      const next = prev.map((it) => ({ ...it }));
      next[idx] = { ...next[idx], unitPriceInput: raw };
      return next;
    });
  };

  const editClampUnitPrice = (productId) => {
    setEditLines((prev) => {
      const idx = prev.findIndex((it) => it.productId === productId);
      if (idx < 0) return prev;

      const next = prev.map((it) => ({ ...it }));
      const parsed = toMoney(next[idx].unitPriceInput);
      const clamped = parsed == null ? 0 : Math.max(0, parsed);
      next[idx] = { ...next[idx], unitPriceInput: String(clamped) };
      return next;
    });
  };

  const editAddProduct = (p) => {
    if (!p) return;
    const stock = Number(p.stock ?? 0);
    if (stock <= 0) return;

    setEditLines((prev) => {
      const next = prev.map((it) => ({ ...it }));
      const idx = next.findIndex((it) => it.productId === p.id);

      const originalQty = Number(editOriginalQtyByPid?.[p.id] ?? 0);
      const maxQty = Math.max(0, Number(p.stock ?? 0) + originalQty);

      if (idx >= 0) {
        const cur = next[idx];
        const nextQty = Math.min(maxQty || 1, Number(cur.qty) + 1);
        next[idx] = { ...cur, qty: nextQty };
        return next;
      }

      next.push({
        productId: p.id,
        name: p.name,
        qty: 1,
        unitPriceInput: String(toMoney(p.price) ?? 0),
      });
      return next;
    });
  };

  const saveEditedSale = () => {
    if (!editSaleId) return;

    setEditError("");

    if (editLines.length === 0) {
      setEditError("A sale must have at least one item.");
      return;
    }

    const items = [];
    for (const it of editLines) {
      const qty = Number.parseInt(String(it.qty), 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        setEditError(`Enter a valid quantity for "${it.name}".`);
        return;
      }

      const unitPrice = toMoney(it.unitPriceInput);
      if (unitPrice == null || unitPrice < 0) {
        setEditError(`Enter a valid unit price for "${it.name}".`);
        return;
      }

      items.push({ productId: it.productId, qty, unitPrice });
    }

    const payload = {
      customerName: editCustomerName.trim() || null,
      items,
    };

    setEditBusy(true);
    updateSale(editSaleId, payload)
      .then(() => {
        closeEditModal();
        reloadSales();

        const controller = new AbortController();
        listProducts({ signal: controller.signal })
          .then((data) => setProducts(Array.isArray(data) ? data : []))
          .catch(() => {});

        refreshShiftNow();
      })
      .catch((err) => setEditError(err?.message || "Failed to update sale"))
      .finally(() => setEditBusy(false));
  };

  const deleteEditedSale = () => {
    if (!editSaleId) return;

    setEditError("");

    const ok = window.confirm(
      `Delete sale #${editSaleId}? This will restore stock and remove the sale from reports.`
    );
    if (!ok) return;

    setEditBusy(true);
    deleteSale(editSaleId)
      .then((data) => {
        // Warn if stock couldn't be restored for some lines (product deleted from catalog).
        const missing = Array.isArray(data?.missingProducts) ? data.missingProducts : [];
        if (missing.length > 0) {
          const msg = missing
            .map((m) => `${m.name || `Product ${m.productId}`} (x${m.qty})`)
            .join(", ");
          window.alert(`Sale deleted, but stock could not be restored for: ${msg}`);
        }

        closeEditModal();
        reloadSales();

        const controller = new AbortController();
        listProducts({ signal: controller.signal })
          .then((data2) => setProducts(Array.isArray(data2) ? data2 : []))
          .catch(() => {});

        refreshShiftNow();
      })
      .catch((err) => setEditError(err?.message || "Failed to delete sale"))
      .finally(() => setEditBusy(false));
  };

  const doOpenShift = () => {
    setShiftError("");
    const val = Number(openingFloat);
    if (!Number.isFinite(val) || val < 0) {
      setShiftError("Opening float must be a valid number >= 0.");
      return;
    }

    setShiftBusy(true);
    openShift({ openingFloat: val })
      .then((created) => {
        setOpenShiftData(created);
        setClosingCash("");
      })
      .catch((err) => setShiftError(err?.message || "Failed to open shift"))
      .finally(() => setShiftBusy(false));
  };

  const doCloseShift = () => {
    setShiftError("");
    if (!openShiftData?.id) return;

    const val = Number(closingCash);
    if (!Number.isFinite(val) || val < 0) {
      setShiftError("Closing cash must be a valid number >= 0.");
      return;
    }

    if (!window.confirm("Close this shift and record cash-up?")) return;

    setShiftBusy(true);
    closeShift(openShiftData.id, { closingCash: val })
      .then(() => refreshShiftNow())
      .catch((err) => setShiftError(err?.message || "Failed to close shift"))
      .finally(() => setShiftBusy(false));
  };

  const printReceiptBluetooth = async () => {
    setBtPrintError("");
    if (!receiptText) return;

    let address = "";
    try {
      address = localStorage.getItem(BT_PRINTER_ADDRESS_KEY) || "";
    } catch {
      address = "";
    }

    if (!address) {
      setBtPrintError("No Bluetooth printer selected. Go to Settings -> Printing to choose a paired printer.");
      return;
    }

    setBtPrintBusy(true);
    try {
      await requestBluetoothPermission();
      await connectPrinter(address);
      await printText(receiptText, { feedLines: 6 });
    } catch (err) {
      setBtPrintError(err?.message || "Failed to print via Bluetooth");
    } finally {
      try {
        await disconnectPrinter();
      } catch {
        // ignore
      }
      setBtPrintBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Sales / Orders</h1>
          <p>Ring up items, keep stock accurate, and print receipts in seconds.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>Total</div>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.4 }}>
              {formatCurrency(salesTotal)}
            </div>
          </div>
        </div>
      </div>

      {loadError ? <div className="banner" style={{ marginBottom: 12 }}>{loadError}</div> : null}
      {submitError ? <div className="banner" style={{ marginBottom: 12 }}>{submitError}</div> : null}

      <div className="grid">
        <div className="card col-7">
          <div className="card-header">
            <h3>Products</h3>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              {products === null ? "Loading..." : `${productResults.length} items`}
            </div>
          </div>

          <div className="table-wrap" aria-label="Products list">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {products === null ? (
                  <tr>
                    <td colSpan={3}>Loading products...</td>
                  </tr>
                ) : productResults.length > 0 ? (
                  productResults.slice(0, 14).map((p) => {
                    const stock = Number(p.stock ?? 0);
                    const disabled = stock <= 0;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => {
                          if (disabled) return;
                          addToCart(p);
                        }}
                        onKeyDown={(e) => {
                          if (disabled) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            addToCart(p);
                          }
                        }}
                        role={disabled ? undefined : "button"}
                        tabIndex={disabled ? -1 : 0}
                        aria-disabled={disabled}
                        style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}
                        title={disabled ? "Out of stock" : "Tap to add"}
                      >
                        <td>
                          <strong style={{ letterSpacing: -0.2 }}>{p.name}</strong>
                        </td>
                        <td>{formatCurrency(Number(p.price ?? 0))}</td>
                        <td>{stock}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3}>No products found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card col-5">
          <div className="card-header">
            <h3>Current Sale</h3>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              {cart.length ? `${cart.length} lines` : "Ready"}
            </div>
          </div>

          <div
            className="shift-panel"
            style={{
              padding: 12,
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "color-mix(in srgb, var(--surface-solid) 55%, transparent)",
              marginBottom: 12,
            }}
          >
	            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
	              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: -0.2 }}>Shift</div>
	              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
	                {openShiftData === undefined ? "Loading..." : openShiftData ? "Open" : "Closed"}
	              </div>
	            </div>

            {shiftError ? <div className="banner" style={{ marginTop: 10 }}>{shiftError}</div> : null}

	            {openShiftData === undefined ? (
	              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700, marginTop: 10 }}>
	                Loading shift status...
	              </div>
	            ) : openShiftData ? (
	              <div className="shift-grid">
	                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
	                  Opened: <strong>{openShiftData.openedAt ? formatDateTime(openShiftData.openedAt) : "-"}</strong>
	                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  Float: <strong>{formatCurrency(Number(openShiftData.openingFloat || 0))}</strong>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  Sales: <strong>{formatCurrency(Number(openShiftData.salesTotal || 0))}</strong>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  Expected: <strong>{formatCurrency(Number(openShiftData.expectedCash || 0))}</strong>
                </div>

                <div className="field shift-wide">
                  <label>Closing Cash</label>
                  <div className="shift-action-row">
                    <input
                      className="input sm"
                      style={{ flex: "1 1 auto" }}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={closingCash}
                      onChange={(e) => setClosingCash(e.target.value)}
                      placeholder="0.00"
                    />
                    <button className="btn primary" type="button" onClick={doCloseShift} disabled={shiftBusy}>
                      {shiftBusy ? "Closing..." : "Cash-up"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Opening Float</label>
                  <div className="shift-action-row">
                    <input
                      className="input sm"
                      style={{ flex: "1 1 auto" }}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={openingFloat}
                      onChange={(e) => setOpeningFloat(e.target.value)}
                    />
                    <button className="btn" type="button" onClick={doOpenShift} disabled={shiftBusy}>
                      {shiftBusy ? "Opening..." : "Open Shift"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {me && String(me.role) !== "admin" && !canDiscount ? (
            <div className="banner" style={{ marginBottom: 12 }}>
              Discounts are locked for your account. Ask an admin to enable it in Settings / Users.
            </div>
          ) : null}

          <form onSubmit={completeSale}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Cashier</label>
              <div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me?.name || "-"}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>
                  {me?.username ? `@${me.username}` : String(me?.role || "")}
                </div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>Customer (optional)</label>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in, member name, etc."
              />
            </div>

            <div className="divider" />

            {cart.length === 0 ? (
              <p style={{ margin: "12px 0", color: "var(--muted)", fontSize: 13 }}>
                Add products from the left to build a sale.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
                {cart.map((it) => (
                  <div key={it.productId} className="cart-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {it.name}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        Base {formatCurrency(toMoney(it.basePrice) ?? 0)} - Stock{" "}
                        {Number(productMap.get(it.productId)?.stock ?? it.stock ?? 0)}
                      </div>
                      {canDiscount ? (
                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Unit price</span>
                          <input
                            className="input sm"
                            style={{ width: 120 }}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={toMoney(it.basePrice) ?? 0}
                            step="0.01"
                            value={it.unitPriceInput}
                            onChange={(e) => updateUnitPriceInput(it.productId, e.target.value)}
                            onBlur={() => clampUnitPrice(it.productId)}
                          />
                          {toMoney(it.unitPriceInput) != null &&
                          toMoney(it.basePrice) != null &&
                          toMoney(it.unitPriceInput) < toMoney(it.basePrice) ? (
                            <span className="badge warn">Discount</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="qty">
                      <button
                        className="icon-btn sm"
                        type="button"
                        onClick={() => updateQty(it.productId, Number(it.qty) - 1)}
                        aria-label="Decrease quantity"
                        disabled={Number(it.qty) <= 1}
                      >
                        -
                      </button>
                      <input
                        className="input sm"
                        style={{ width: 64, textAlign: "center" }}
                        type="number"
                        min="1"
                        max={Number(productMap.get(it.productId)?.stock ?? it.stock ?? 0)}
                        step="1"
                        value={it.qty}
                        onChange={(e) => updateQty(it.productId, e.target.value)}
                      />
                      <button
                        className="icon-btn sm"
                        type="button"
                        onClick={() => updateQty(it.productId, Number(it.qty) + 1)}
                        aria-label="Increase quantity"
                        disabled={Number(it.qty) >= Number(productMap.get(it.productId)?.stock ?? it.stock ?? 0)}
                      >
                        +
                      </button>
                    </div>

                    <div style={{ textAlign: "right", minWidth: 86, fontWeight: 900 }}>
                      {formatCurrency(Number(it.qty) * Number(toMoney(it.unitPriceInput) ?? 0))}
                    </div>

                    <button
                      className="icon-btn sm"
                      type="button"
                      onClick={() => removeFromCart(it.productId)}
                      aria-label="Remove"
                      title="Remove"
                    >
                      <TrashIcon className="nav-icon" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Subtotal</div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.4 }}>
                {formatCurrency(cartSubtotal)}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button className="btn" type="button" onClick={() => setCart([])} disabled={submitting || cart.length === 0}>
                Clear
              </button>
              <button className="btn primary" type="submit" disabled={submitting || cart.length === 0}>
                {submitting ? "Completing..." : "Complete Sale"}
              </button>
            </div>
          </form>
        </div>

        <div className="card col-12">
          <div className="card-header">
            <h3>Recent Sales</h3>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              {sales === null || salesLoading ? "Loading..." : `${filteredSales.length} results`}
            </div>
          </div>

          {isAdmin ? (
            <div className="field-row" style={{ padding: "0 18px 14px", alignItems: "flex-end" }}>
              <div className="field">
                <label>From</label>
                <input className="input sm" type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>To</label>
                <input className="input sm" type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} />
              </div>
              <div className="field">
                <label>Limit</label>
                <input
                  className="input sm"
                  style={{ width: 110 }}
                  type="number"
                  min="1"
                  max="2000"
                  value={salesLimit}
                  onChange={(e) => setSalesLimit(e.target.value)}
                />
              </div>
              <div className="field" style={{ marginLeft: "auto" }}>
                <label style={{ opacity: 0 }}>Load</label>
                <div className="row-actions">
                  <button className="btn" type="button" onClick={() => reloadSales()} disabled={salesLoading}>
                    {salesLoading ? "Loading..." : "Load"}
                  </button>
                  <button className="btn ghost" type="button" onClick={resetSalesFilters} disabled={salesLoading}>
                    Reset
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="table-wrap scroll-y" aria-label="Recent sales">
            <table className="table table-plain table-wide">
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Cashier</th>
                <th>Date</th>
                <th>Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sales === null || salesLoading ? (
                <tr>
                  <td colSpan={6}>Loading sales...</td>
                </tr>
              ) : filteredSales.length > 0 ? (
                filteredSales.map((s) => {
                  const dt = formatDateTimeParts(s.createdAt);
                  return (
                    <tr key={s.id}>
                      <td>#{s.id}</td>
                      <td>{s.customerName || "Walk-in"}</td>
                      <td>{s.cashierName || "-"}</td>
                      <td>
                        <div className="cell-main">{dt.date}</div>
                        {dt.time ? <div className="cell-sub">{dt.time}</div> : null}
                      </td>
                      <td>{formatCurrency(Number(s.total || 0))}</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="row-actions">
                          <button className="btn" type="button" onClick={() => openReceiptForSale(s.id)} disabled={submitting || editBusy}>
                            Print
                          </button>
                          {isAdmin ? (
                            <button className="btn ghost" type="button" onClick={() => openEditForSale(s.id)} disabled={submitting || editBusy}>
                              Edit
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>No sales yet.</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={editOpen}
        title="Edit Sale"
        subtitle={editSaleId ? `Sale #${editSaleId}` : "Edit sale"}
        onClose={closeEditModal}
      >
        {editBusy && editLines.length === 0 ? (
          <p style={{ margin: "8px 0", color: "var(--muted)", fontSize: 13 }}>Loading sale...</p>
        ) : null}

        <div className="field-row" style={{ marginBottom: 12 }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label>Date</label>
            <div className="input" style={{ display: "flex", alignItems: "center" }}>
              {editCreatedAt ? formatDateTime(editCreatedAt) : "-"}
            </div>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Cashier</label>
            <div className="input" style={{ display: "flex", alignItems: "center" }}>
              {editCashierName || "-"}
            </div>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Customer (optional)</label>
          <input
            className="input"
            value={editCustomerName}
            onChange={(e) => setEditCustomerName(e.target.value)}
            placeholder="Walk-in, member name, etc."
            disabled={editBusy}
          />
        </div>

        <div className="divider" />

        <div className="field" style={{ marginTop: 12 }}>
          <label>Add product</label>
          <input
            className="input"
            value={editProductQuery}
            onChange={(e) => setEditProductQuery(e.target.value)}
            placeholder="Search products to add..."
            disabled={editBusy}
          />
        </div>

        {editProductQuery ? (
          <div className="table-wrap scroll-y" style={{ maxHeight: 240, marginTop: 10 }} aria-label="Add products">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {editProductResults.length > 0 ? (
                  editProductResults.map((p) => {
                    const stock = Number(p.stock ?? 0);
                    const disabled = stock <= 0;
                    return (
                      <tr
                        key={`edit-add-${p.id}`}
                        onClick={() => {
                          if (disabled) return;
                          editAddProduct(p);
                        }}
                        style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}
                        title={disabled ? "Out of stock" : "Tap to add"}
                      >
                        <td>
                          <strong style={{ letterSpacing: -0.2 }}>{p.name}</strong>
                        </td>
                        <td>{formatCurrency(Number(p.price ?? 0))}</td>
                        <td>{stock}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3}>No matching products.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="divider" />

        {editLines.length === 0 ? (
          <p style={{ margin: "12px 0", color: "var(--muted)", fontSize: 13 }}>No items in this sale.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
            {editLines.map((it) => {
              const product = productMap.get(it.productId);
              const currentStock = Number(product?.stock ?? 0);
              const originalQty = Number(editOriginalQtyByPid?.[it.productId] ?? 0);
              const maxQty = product ? currentStock + originalQty : originalQty;
              const qtyDisabled = !product || editBusy;

              return (
                <div key={`edit-line-${it.productId}`} className="cart-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it.name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {product ? (
                        <>
                          Stock {currentStock} • Max {maxQty}
                        </>
                      ) : (
                        <>Product removed from catalog (quantity locked)</>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Unit price</span>
                      <input
                        className="input sm"
                        style={{ width: 140 }}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={it.unitPriceInput}
                        onChange={(e) => editUpdateUnitPriceInput(it.productId, e.target.value)}
                        onBlur={() => editClampUnitPrice(it.productId)}
                        disabled={editBusy}
                      />
                    </div>
                  </div>

                  <div className="qty">
                    <button className="btn" type="button" onClick={() => editUpdateQty(it.productId, Number(it.qty) - 1)} disabled={qtyDisabled || Number(it.qty) <= 1}>
                      -
                    </button>
                    <input
                      className="input sm"
                      style={{ width: 64, textAlign: "center" }}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={maxQty}
                      value={it.qty}
                      onChange={(e) => editUpdateQty(it.productId, e.target.value)}
                      disabled={qtyDisabled}
                      aria-label="Quantity"
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={() => editUpdateQty(it.productId, Number(it.qty) + 1)}
                      disabled={qtyDisabled || Number(it.qty) >= Number(maxQty || 0)}
                    >
                      +
                    </button>
                  </div>

                  <div style={{ textAlign: "right", minWidth: 86, fontWeight: 900 }}>
                    {formatCurrency(Number(it.qty) * Number(toMoney(it.unitPriceInput) ?? 0))}
                  </div>

                  <button
                    className="icon-btn sm"
                    type="button"
                    onClick={() => editRemoveLine(it.productId)}
                    aria-label="Remove"
                    title="Remove"
                    disabled={editBusy}
                  >
                    <TrashIcon className="nav-icon" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="divider" />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Updated total</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.4 }}>
            {formatCurrency(editSubtotal)}
          </div>
        </div>

        {editError ? <div className="banner" style={{ marginTop: 12 }}>{editError}</div> : null}

        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
          <button className="btn danger" type="button" onClick={deleteEditedSale} disabled={editBusy || !editSaleId}>
            Delete Sale
          </button>
          <div className="row-actions">
            <button className="btn ghost" type="button" onClick={closeEditModal} disabled={editBusy}>
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={saveEditedSale} disabled={editBusy || editLines.length === 0}>
              {editBusy ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={receiptOpen}
        title="Receipt"
        subtitle={receipt?.id ? `Sale #${receipt.id}` : "Sale receipt"}
        onClose={() => setReceiptOpen(false)}
      >
        <div className="receipt">
          <div className="receipt-head">
            <div>
              <div className="receipt-store">T-ONE</div>
              <div className="receipt-sub">Receipt</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="receipt-sub">{receipt?.createdAt ? formatDateTime(receipt.createdAt) : ""}</div>
              <div className="receipt-sub">{receipt?.cashier?.name ? `Cashier: ${receipt.cashier.name}` : ""}</div>
            </div>
          </div>

          <div className="receipt-meta">
            <div>
              <strong>Customer:</strong> {receipt?.customerName || "Walk-in"}
            </div>
            <div>
              <strong>Sale:</strong> #{receipt?.id || "-"}
            </div>
          </div>

          <div className="divider" />

          <div className="screen-only">
            <table className="receipt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(receipt?.items || []).map((it) => (
                  <tr key={`${it.productId}-${it.name}`}>
                    <td>{it.name}</td>
                    <td>{it.qty}</td>
                    <td>{formatCurrency(it.unitPrice)}</td>
                    <td style={{ textAlign: "right" }}>{formatCurrency(it.lineTotal ?? it.unitPrice * it.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="print-only receipt-lines" aria-label="Receipt items (print)">
            {(receipt?.items || []).map((it) => {
              const lineTotal = Number(it.lineTotal ?? it.unitPrice * it.qty);
              return (
                <div className="receipt-line" key={`${it.productId}-${it.name}`}>
                  <div className="receipt-line-top">
                    <div className="receipt-item">{it.name}</div>
                    <div className="receipt-amount">{formatCurrency(lineTotal)}</div>
                  </div>
                  <div className="receipt-line-sub">
                    {it.qty} x {formatCurrency(Number(it.unitPrice))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="divider" />

          <div className="receipt-total">
            <div>Total</div>
            <div>{formatCurrency(Number(receipt?.total || 0))}</div>
          </div>

          <div className="receipt-footer print-only" aria-label="Receipt footer (print)">
            <div>Thank you for shopping with us</div>
          </div>

          <div className="modal-actions no-print">
            <button className="btn ghost" type="button" onClick={() => setReceiptOpen(false)}>
              Close
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={androidNative ? printReceiptBluetooth : () => window.print()}
              disabled={!receiptText || btPrintBusy}
            >
              {btPrintBusy ? "Printing..." : "Bluetooth Print"}
            </button>
          </div>
          {btPrintError ? <div className="banner no-print" style={{ marginTop: 12 }}>{btPrintError}</div> : null}
        </div>
      </Modal>
    </section>
  );
}
