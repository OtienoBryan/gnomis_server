const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication to all dashboard routes
router.use(authenticateToken);

// Optimized consolidated dashboard data endpoint
router.get('/sales-dashboard-data', dashboardController.getSalesDashboardData);
router.get('/team-leader-dashboard-data', dashboardController.getTeamLeaderDashboardData);

// Lazy-loaded endpoints for charts
router.get('/product-performance', dashboardController.getProductPerformance);
router.get('/current-month-pie', dashboardController.getCurrentMonthPieData);
router.get('/outlets-visited', dashboardController.getOutletsVisited);
router.get('/orders-summary', dashboardController.getOrdersSummary);
router.get('/checked-in-sales-reps', dashboardController.getCheckedInSalesReps);

module.exports = router;


