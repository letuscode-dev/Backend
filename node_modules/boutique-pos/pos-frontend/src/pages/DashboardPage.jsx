import { useEffect, useMemo, useState } from "react";
import LineChart from "../components/charts/LineChart.jsx";
import { listProducts } from "../api/products.js";
import { listSales } from "../api/sales.js";

// Avoid calling time-based functions during render (ESLint react-hooks/purity).
const DASHBOARD_NOW_MS = Date.now();
const DASHBOARD_NOW_DATE = new Date(DASHBOARD_NOW_MS);

function formatCurrency(amount) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
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

export default function DashboardPage() {
  const [products, setProducts] = useState(null);
  const [sales, setSales] = useState(null);
  const [productsError, setProductsError] = useState("");
  const [salesError, setSalesError] = useState("");

  const totalSales = useMemo(() => {
    if (!Array.isArray(sales)) return 0;
    const ms14d = 14 * 24 * 60 * 60 * 1000;
    return sales.reduce((acc, s) => {
      const t = Date.parse(s.createdAt);
      if (!Number.isFinite(t)) return acc;
      if (DASHBOARD_NOW_MS - t > ms14d) return acc;
      return acc + Number(s.total || 0);
    }, 0);
  }, [sales]);

  const series = useMemo(() => {
    const days = 7;
    const now = DASHBOARD_NOW_DATE;
    const buckets = new Map();

    const pad2 = (n) => String(n).padStart(2, "0");
    for (let i = 0; i < days; i += 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - (days - 1 - i));
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      buckets.set(key, 0);
    }

    if (Array.isArray(sales)) {
      sales.forEach((s) => {
        const key = String(s.createdAt || "").slice(0, 10);
        if (!buckets.has(key)) return;
        buckets.set(key, buckets.get(key) + Number(s.total || 0));
      });
    }

    return [...buckets.entries()].map(([date, value]) => ({
      date,
      value: Math.round(value * 100) / 100,
      label: date.slice(5),
    }));
  }, [sales]);

  const lowStockThreshold = 5;
  const lowStockCount = useMemo(() => {
    if (!Array.isArray(products)) return 0;
    return products.filter((p) => Number(p.stock ?? 0) > 0 && Number(p.stock ?? 0) <= lowStockThreshold).length;
  }, [products]);

  useEffect(() => {
    const controller = new AbortController();

    listProducts({ signal: controller.signal })
      .then((data) => {
        setProductsError("");
        setProducts(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setProductsError(err?.message || "Failed to load products");
        setProducts([]);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    listSales({ signal: controller.signal })
      .then((data) => {
        setSalesError("");
        setSales(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setSalesError(err?.message || "Failed to load sales");
        setSales([]);
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Dashboard</h1>
          <p>Sales and inventory at a glance.</p>
        </div>
      </div>

      {productsError || salesError ? <div className="banner">{productsError || salesError}</div> : null}

      <div className="grid kpis">
        <div className="card col-3">
          <div className="card-header">
            <h3>Total Sales</h3>
          </div>
          <div className="kpi-value">{formatCurrency(totalSales)}</div>
          <p className="kpi-sub">Last 14 days</p>
        </div>

        <div className="card col-3">
          <div className="card-header">
            <h3>Total Products</h3>
          </div>
          <div className="kpi-value">{products === null ? "..." : products.length}</div>
          <p className="kpi-sub">Live inventory count</p>
        </div>

        <div className="card col-3">
          <div className="card-header">
            <h3>Low Stock Alert</h3>
          </div>
          <div className="kpi-value">{products === null ? "..." : lowStockCount}</div>
          <p className="kpi-sub">At or below {lowStockThreshold} units</p>
        </div>

        <div className="card col-3">
          <div className="card-header">
            <h3>Today</h3>
          </div>
          <div className="kpi-value">{series[series.length - 1] ? formatCurrency(series[series.length - 1].value) : "$0"}</div>
          <p className="kpi-sub">Daily revenue</p>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card col-6">
          <div className="card-header">
            <h3>Daily Revenue</h3>
          </div>
          <LineChart series={series} />
        </div>

        <div className="card col-6">
          <div className="card-header">
            <h3>Recent Transactions</h3>
          </div>
          <div className="table-wrap scroll-y" aria-label="Recent transactions">
            <table className="table table-plain table-wide">
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Cashier</th>
                <th>Date</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sales === null ? (
                <tr>
                  <td colSpan={5}>Loading sales...</td>
                </tr>
              ) : sales.length > 0 ? (
                sales.slice(0, 20).map((s) => {
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
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5}>No sales yet.</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
