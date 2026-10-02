const express = require('express');
const router = express.Router();
const shortExpiryReportController = require('../controllers/shortExpiryReportController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all short expiry report routes
router.use(authenticateToken);

router.get('/', shortExpiryReportController.getAllShortExpiryReports);
router.get('/export', shortExpiryReportController.exportShortExpiryReportsCSV);
router.get('/outlets', shortExpiryReportController.getShortExpiryOutlets);
router.get('/sales-reps', shortExpiryReportController.getShortExpirySalesReps);

module.exports = router;
