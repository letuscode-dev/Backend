import { useState } from "react";
import { PlusIcon } from "../components/icons/Icons.jsx";
import ProductTable from "../components/ProductTable.jsx";

export default function ProductsPage({
  search,
  onSearchChange,
  addProductOpen,
  onOpenAddProduct,
  onCloseAddProduct,
  me,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const isAdmin = String(me?.role || "").toLowerCase() === "admin";

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Products</h1>
          <p>{isAdmin ? "Manage boutique inventory with fast edits and clean status signals." : "Browse products and stock levels."}</p>
        </div>

        {isAdmin ? (
          <button className="btn primary" type="button" onClick={onOpenAddProduct}>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <PlusIcon className="nav-icon" />
              Add Product
            </span>
          </button>
        ) : null}
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
          <label>Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>
        </div>
      </div>

      <ProductTable
        search={search}
        statusFilter={statusFilter}
        addProductOpen={addProductOpen}
        onOpenAddProduct={onOpenAddProduct}
        onCloseAddProduct={onCloseAddProduct}
        canManage={isAdmin}
      />
    </section>
  );
}
