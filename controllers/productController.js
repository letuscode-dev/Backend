const db = require("../config/db");

function parseId(idRaw) {
  const id = Number.parseInt(String(idRaw), 10);
  return Number.isFinite(id) ? id : null;
}

function parseNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Create product
exports.createProduct = (req, res) => {
  const { name, price, stock } = req.body;
  const costPriceRaw = req.body?.costPrice ?? req.body?.cost_price ?? req.body?.cost;

  // Validation
  if (!name || price == null) {
    return res.status(400).json({
      error: "Name and price are required",
    });
  }

  const parsedPrice = parseNumber(price);
  const parsedCostPrice = costPriceRaw == null || costPriceRaw === "" ? 0 : parseNumber(costPriceRaw);
  const parsedStock = stock == null ? 0 : parseNumber(stock);

  if (parsedPrice == null || parsedPrice < 0) {
    return res.status(400).json({ error: "Price must be a valid number" });
  }

  if (parsedCostPrice == null || parsedCostPrice < 0) {
    return res.status(400).json({ error: "Cost price must be a valid number" });
  }

  if (parsedStock == null || parsedStock < 0) {
    return res.status(400).json({ error: "Stock must be a valid number" });
  }

  const sql = "INSERT INTO products (name, price, cost_price, stock) VALUES (?, ?, ?, ?)";

  db.query(sql, [name, parsedPrice, parsedCostPrice, parsedStock], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({
      id: result.insertId,
      name,
      price: parsedPrice,
      costPrice: parsedCostPrice,
      stock: parsedStock,
    });
  });
};

// Get all products
exports.getProducts = (req, res) => {
  const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
  const sql = isAdmin
    ? "SELECT id, name, price, cost_price AS costPrice, stock FROM products ORDER BY id DESC"
    : "SELECT id, name, price, stock FROM products ORDER BY id DESC";

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
};

// Update product
exports.updateProduct = (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid product id" });

  const { name, price, stock } = req.body;
  const costPriceRaw = req.body?.costPrice ?? req.body?.cost_price ?? req.body?.cost;

  if (!name || price == null || stock == null || costPriceRaw == null) {
    return res.status(400).json({ error: "Name, price, cost price and stock are required" });
  }

  const parsedPrice = parseNumber(price);
  const parsedCostPrice = parseNumber(costPriceRaw);
  const parsedStock = parseNumber(stock);

  if (parsedPrice == null || parsedPrice < 0) {
    return res.status(400).json({ error: "Price must be a valid number" });
  }

  if (parsedCostPrice == null || parsedCostPrice < 0) {
    return res.status(400).json({ error: "Cost price must be a valid number" });
  }

  if (parsedStock == null || parsedStock < 0) {
    return res.status(400).json({ error: "Stock must be a valid number" });
  }

  const sql = "UPDATE products SET name = ?, price = ?, cost_price = ?, stock = ? WHERE id = ?";

  db.query(sql, [name, parsedPrice, parsedCostPrice, parsedStock, id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json({ id, name, price: parsedPrice, costPrice: parsedCostPrice, stock: parsedStock });
  });
};

// Delete product
exports.deleteProduct = (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid product id" });

  const sql = "DELETE FROM products WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json({ success: true, id });
  });
};
