const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all brands
router.get('/', brandController.getAllBrands);

// Get brand by ID
router.get('/:id', brandController.getBrandById);

// Create new brand
router.post('/', brandController.createBrand);

// Update brand
router.put('/:id', brandController.updateBrand);

// Delete brand
router.delete('/:id', brandController.deleteBrand);

module.exports = router;
