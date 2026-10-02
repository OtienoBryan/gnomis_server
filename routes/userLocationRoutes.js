const express = require('express');
const router = express.Router();
const userLocationController = require('../controllers/userLocationController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/staff', userLocationController.getStaffLocations);
router.get('/users', userLocationController.getUsersWithLocation);
router.get('/journey/:userId', userLocationController.getUserJourney);

module.exports = router;
