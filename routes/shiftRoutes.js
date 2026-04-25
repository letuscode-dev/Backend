const express = require("express");
const router = express.Router();

const shiftController = require("../controllers/shiftController");
const { requireAdmin } = require("../middleware/auth");

router.get("/", requireAdmin, shiftController.listShifts);
router.get("/open", shiftController.getOpenShift);
router.post("/open", shiftController.openShift);
router.post("/:id/close", shiftController.closeShift);

module.exports = router;
