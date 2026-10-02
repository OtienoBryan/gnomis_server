const express = require('express');
const router = express.Router();
const brandSosTargetController = require('../controllers/brandSosTargetController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all brand SOS targets (with optional filters)
router.get('/', brandSosTargetController.getAllBrandSosTargets);

// Get brand SOS targets for an outlet account
router.get('/outlet-account/:outletAccountId', brandSosTargetController.getBrandSosTargetsByOutletAccount);

// Create or update a brand SOS target
router.post('/', brandSosTargetController.setBrandSosTarget);

// Delete a brand SOS target
router.delete('/:id', brandSosTargetController.deleteBrandSosTarget);

module.exports = router;
