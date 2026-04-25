import {
  DashboardIcon,
  InventoryIcon,
  PlusIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  SettingsIcon,
  XIcon,
} from "../icons/Icons.jsx";
import { Capacitor } from "@capacitor/core";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: DashboardIcon },
  { key: "products", label: "Products", path: "/products", icon: ProductsIcon },
  { key: "sales", label: "Sales / Orders", path: "/sales", icon: SalesIcon },
  { key: "add", label: "Add Product", path: "/products", icon: PlusIcon },
  { key: "inventory", label: "Inventory", path: "/inventory", icon: InventoryIcon },
  { key: "reports", label: "Reports", path: "/reports", icon: ReportsIcon },
  { key: "settings", label: "Settings", path: "/settings", icon: SettingsIcon },
];

export default function Sidebar({
  activeKey,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  onAddProduct,
  me,
}) {
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  const isAdmin = String(me?.role || "").toLowerCase() === "admin";

  const items = NAV_ITEMS.filter((it) => {
    if (isAdmin) return true;
    // Cashiers: keep the UI focused on selling.
    if (it.key === "add") return false;
    if (it.key === "inventory") return false;
    if (it.key === "reports") return false;
    return true;
  });

  return (
    <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} data-collapsed={collapsed ? "true" : "false"}>
      <div className="brand" title="T-ONE">
        <div className="brand-mark">T1</div>
        {collapsed ? null : (
          <div className="brand-text">
            <strong>T-ONE</strong>
            {nativeAndroid ? null : <span>Boutique POS</span>}
          </div>
        )}
      </div>

      <nav className="nav" aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.key !== "add" && item.key === activeKey;
          const label = collapsed ? item.label : undefined;

          return (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${isActive ? "is-active" : ""}`}
              onClick={() => {
                if (item.key === "add") {
                  onAddProduct?.();
                  onNavigate?.(item.path);
                } else {
                  onNavigate?.(item.path);
                }
                onCloseMobile?.();
              }}
              aria-label={label}
              title={label}
            >
              <Icon className="nav-icon" />
              {collapsed ? null : <span className="nav-label">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? ">" : "<"}
        </button>
        <button className="icon-btn mobile-only" type="button" onClick={onCloseMobile} aria-label="Close menu">
          <XIcon className="nav-icon" />
        </button>
      </div>
    </aside>
  );
}
