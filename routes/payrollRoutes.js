const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all payroll routes
router.use(authenticateToken);

// GET /api/payroll/payment-accounts
router.get('/payment-accounts', payrollController.getPaymentAccounts);

// GET /api/payroll/history?staff_id=...
router.get('/history', payrollController.getPayrollHistory);

// POST /api/payroll/history
router.post('/history', payrollController.addPayrollRecord);

// POST /api/payroll/run
router.post('/run', payrollController.runPayroll);

// GET /api/payroll/deductions
router.get('/deductions', payrollController.getAllDeductions);

// GET /api/payroll/deductions/accounts (liability accounts, account_type = 10)
router.get('/deductions/accounts', payrollController.getDeductionAccounts);

// POST /api/payroll/deductions
router.post('/deductions', payrollController.createDeduction);

// PUT /api/payroll/deductions/:id
router.put('/deductions/:id', payrollController.updateDeduction);

// DELETE /api/payroll/deductions/:id
router.delete('/deductions/:id', payrollController.deleteDeduction);

// POST /api/payroll/run-sales-reps
router.post('/run-sales-reps', payrollController.runSalesRepPayroll);

// GET /api/payroll/sales-reps-history?sales_rep_id=...
router.get('/sales-reps-history', payrollController.getSalesRepPayrollHistory);

module.exports = router;