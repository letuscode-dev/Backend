const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();

// Middleware
app.set("trust proxy", 1);

const corsOriginRaw = String(process.env.CORS_ORIGIN || "").trim();
const corsOrigin = corsOriginRaw
  ? corsOriginRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : true;

app.use(
  cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("POS API running...");
});

// Routes
const authRoutes = require("./routes/authRoutes");
const { requireAuth } = require("./middleware/auth");
const productRoutes = require("./routes/productRoutes");
const userRoutes = require("./routes/userRoutes");
const saleRoutes = require("./routes/saleRoutes");
const reportRoutes = require("./routes/reportRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const stocktakeRoutes = require("./routes/stocktakeRoutes");
const shiftRoutes = require("./routes/shiftRoutes");
const expenseRoutes = require("./routes/expenseRoutes");

app.use("/api/auth", authRoutes);
// Everything else under /api requires auth.
app.use("/api", requireAuth);
app.use("/api/products", productRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/stocktakes", stocktakeRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/expenses", expenseRoutes);

// Port
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
