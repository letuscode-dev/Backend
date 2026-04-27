const express = require("express");
const router = express.Router();

const reportController = require("../controllers/reportController");
const { requireAdmin } = require("../middleware/auth");

router.get("/overview", requireAdmin, reportController.getOverview);
router.get("/stocktake", requireAdmin, reportController.getOverview);

module.exports = router;
