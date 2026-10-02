const express = require('express');
const router = express.Router();
const competitorActivityReportController = require('../controllers/competitorActivityReportController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all competitor activity report routes
router.use(authenticateToken);

router.get('/', competitorActivityReportController.getAllCompetitorActivityReports);
router.get('/export', competitorActivityReportController.exportCompetitorActivityReportsCSV);
router.get('/outlets', competitorActivityReportController.getCompetitorActivityOutlets);
router.get('/merchandisers', competitorActivityReportController.getCompetitorActivityMerchandisers);

module.exports = router;
