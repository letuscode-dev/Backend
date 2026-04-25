const express = require("express");
const router = express.Router();

const purchaseController = require("../controllers/purchaseController");
const { requireAdmin } = require("../middleware/auth");

router.use(requireAdmin);

router.get("/", purchaseController.getPurchases);
router.get("/:id", purchaseController.getPurchaseById);
router.post("/", purchaseController.createPurchase);
router.put("/:id/items", purchaseController.replacePurchaseItems);
router.post("/:id/receive", purchaseController.receivePurchase);

module.exports = router;
