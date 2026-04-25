const express = require("express");
const router = express.Router();

const reportController = require("../controllers/reportController");
const { requireAdmin } = require("../middleware/auth");

router.get("/stocktake", requireAdmin, reportController.getStocktake);

module.exports = router;
