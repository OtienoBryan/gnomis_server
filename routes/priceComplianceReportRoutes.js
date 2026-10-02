const express = require('express');
const router = express.Router();
const {
  getAllPriceComplianceReports,
  exportPriceComplianceReportsCSV,
  getPriceComplianceOutlets,
  getPriceComplianceSalesReps
} = require('../controllers/priceComplianceReportController');
const { authenticateToken } = require('../middleware/auth');

// Get all price compliance reports with filters and pagination
router.get('/', authenticateToken, getAllPriceComplianceReports);

// Export price compliance reports to CSV
router.get('/export', authenticateToken, exportPriceComplianceReportsCSV);

// Get distinct outlets for filtering
router.get('/outlets', authenticateToken, getPriceComplianceOutlets);

// Get distinct sales reps for filtering
router.get('/sales-reps', authenticateToken, getPriceComplianceSalesReps);

module.exports = router;
