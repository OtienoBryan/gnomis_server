const express = require('express');
const router = express.Router();
const outletAccountController = require('../controllers/outletAccountController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all outlet accounts
router.get('/', outletAccountController.getAllOutletAccounts);

// Get outlet account by ID
router.get('/:id', outletAccountController.getOutletAccountById);

// Create new outlet account
router.post('/', outletAccountController.createOutletAccount);

// Update outlet account
router.put('/:id', outletAccountController.updateOutletAccount);

// Delete outlet account
router.delete('/:id', outletAccountController.deleteOutletAccount);

module.exports = router;
