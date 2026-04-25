const express = require("express");
const router = express.Router();

const stocktakeController = require("../controllers/stocktakeController");
const { requireAdmin } = require("../middleware/auth");

router.use(requireAdmin);

router.get("/", stocktakeController.listSessions);
router.post("/", stocktakeController.createSession);
router.get("/:id", stocktakeController.getSessionById);
router.put("/:id/items", stocktakeController.updateCounts);
router.post("/:id/close", stocktakeController.closeSession);

module.exports = router;
