const express = require('express');
const router = express.Router();
const sosReportController = require('../controllers/sosReportController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all SOS report routes
router.use(authenticateToken);

// Main listing endpoint
router.get('/', sosReportController.getAllSosReports);

// CSV export
router.get('/export', sosReportController.exportSosReportsCSV);

// Filter helpers
router.get('/outlets', sosReportController.getSosReportOutlets);
router.get('/reps', sosReportController.getSosReportReps);
router.get('/outlet-accounts', sosReportController.getSosReportOutletAccounts);

module.exports = router;

