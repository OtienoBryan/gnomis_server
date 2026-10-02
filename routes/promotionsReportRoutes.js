const express = require('express');
const router = express.Router();
const {
  getAllPromotionsReports,
  getPromotionsOutlets,
  getPromotionsSalesReps
} = require('../controllers/promotionsReportController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, getAllPromotionsReports);
router.get('/outlets', authenticateToken, getPromotionsOutlets);
router.get('/sales-reps', authenticateToken, getPromotionsSalesReps);

module.exports = router;
