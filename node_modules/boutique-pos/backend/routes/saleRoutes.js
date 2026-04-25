const express = require("express");
const router = express.Router();

const saleController = require("../controllers/saleController");
const { requireAdmin } = require("../middleware/auth");

router.get("/", saleController.getSales);
router.get("/:id", saleController.getSaleById);
router.post("/", saleController.createSale);
router.put("/:id", requireAdmin, saleController.updateSale);
router.delete("/:id", requireAdmin, saleController.deleteSale);

module.exports = router;
