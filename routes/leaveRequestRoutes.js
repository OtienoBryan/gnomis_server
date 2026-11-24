const express = require('express');
const router = express.Router();
const leaveRequestController = require('../controllers/leaveRequestController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all leave request routes
router.use(authenticateToken);

// GET /api/leave-requests
router.get('/', leaveRequestController.getAllLeaveRequests);

// GET /api/leave-requests/employee-leaves
router.get('/employee-leaves', leaveRequestController.getEmployeeLeaves);

// GET /api/leave-requests/report
router.get('/report', leaveRequestController.getLeaveReport);

// GET /api/leave-requests/maternal-leave-report
router.get('/maternal-leave-report', leaveRequestController.getMaternalLeaveReport);

// GET /api/leave-requests/sick-leave-report
router.get('/sick-leave-report', leaveRequestController.getSickLeaveReport);

// GET /api/leave-requests/compassionate-leave-report
router.get('/compassionate-leave-report', leaveRequestController.getCompassionateLeaveReport);

// GET /api/leave-requests/paternal-leave-report
router.get('/paternal-leave-report', leaveRequestController.getPaternalLeaveReport);

// Posting leave from the Employee Leaves page (with leave balance check)
const multer = require('multer');
const leavePosting = require('../controllers/leavePostingController');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/leave-requests/leave-types
router.get('/leave-types', leavePosting.getLeaveTypes);

// GET /api/leave-requests/balance?employee_id=&leave_type_id=&start_date=&end_date=
router.get('/balance', leavePosting.getBalance);

// POST /api/leave-requests  (multipart, optional "attachment" file)
router.post('/', upload.single('attachment'), leavePosting.createLeave);

// PATCH /api/leave-requests/:id/status
router.patch('/:id/status', leaveRequestController.updateLeaveRequestStatus);

module.exports = router; 

