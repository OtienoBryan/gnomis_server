const express = require('express');
const router = express.Router();
const { getCustomerOrdersData, setOrderPrinted } = require('../controllers/customerOrdersController');
const { authenticateToken } = require('../middleware/auth');

// Get all customer orders data (consolidated endpoint with pagination)
router.get('/data', authenticateToken, getCustomerOrdersData);

// Mark an approved order as printed / not printed
router.patch('/:id/printed', authenticateToken, setOrderPrinted);

module.exports = router;


