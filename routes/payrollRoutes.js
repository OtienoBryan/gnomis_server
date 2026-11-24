const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');
const run = require('../controllers/payrollRunController');
const repDeductions = require('../controllers/salesRepDeductionController');
const repAdvances = require('../controllers/salesRepAdvanceController');
const staffAdvances = require('../controllers/staffAdvanceController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Apply authentication middleware to all payroll routes
router.use(authenticateToken);

// ---- Payroll v2: statutory rules, staff payroll profiles, loans, monthly runs, payslips ----
// Same roles that can open the payroll pages may read; only finance-type roles may change/approve/pay.
const VIEW = requireRole(['admin', 'manager', 'accountant', 'executive', 'sales', 'finance', 'hr']);
const MANAGE = requireRole(['admin', 'manager', 'accountant', 'executive', 'finance']);

// Linking ledger accounts is allowed for the same roles that can view payroll (including sales);
// it cannot change rates, approve or pay anything.
router.put('/account-links', VIEW, run.saveAccountLinks);

router.get('/sales-rep-deductions', VIEW, repDeductions.list);
router.post('/sales-rep-deductions', VIEW, repDeductions.create); // sales may post; new rows are always pending
const REVIEW_DEDUCTIONS = requireRole(['admin', 'manager', 'accountant', 'executive', 'sales', 'finance']);
router.put('/sales-rep-deductions/:id/status', REVIEW_DEDUCTIONS, repDeductions.review);
router.delete('/sales-rep-deductions/:id', MANAGE, repDeductions.remove);

// Salary advances: sales and hr can post and review; only finance-type roles can delete
const REVIEW_ADVANCES = requireRole(['admin', 'manager', 'accountant', 'executive', 'sales', 'finance', 'hr']);
router.get('/sales-rep-advances', VIEW, repAdvances.list);
router.post('/sales-rep-advances', VIEW, repAdvances.create); // new rows are always pending
router.put('/sales-rep-advances/:id/status', REVIEW_ADVANCES, repAdvances.review);
router.delete('/sales-rep-advances/:id', MANAGE, repAdvances.remove);

// Staff (employee) salary advances: same permissions as sales rep advances
router.get('/staff-advances', VIEW, staffAdvances.list);
router.post('/staff-advances', VIEW, staffAdvances.create); // new rows are always pending
router.put('/staff-advances/:id/status', REVIEW_ADVANCES, staffAdvances.review);
router.delete('/staff-advances/:id', MANAGE, staffAdvances.remove);

router.get('/accounts', VIEW, run.getAccounts);
router.get('/settings', VIEW, run.getSettings);
router.put('/settings', MANAGE, run.updateSettings);

router.get('/statutory-rules', VIEW, run.getRules);
router.post('/statutory-rules', MANAGE, run.saveRule);
router.put('/statutory-rules/:id', MANAGE, run.saveRule);
router.delete('/statutory-rules/:id', MANAGE, run.deleteRule);
router.post('/calculate', VIEW, run.previewCalculation);

router.get('/staff-payroll', VIEW, run.getStaffPayroll);
router.get('/staff-payroll/:id', VIEW, run.getStaffPayrollDetail);
router.put('/staff-payroll/:id/profile', MANAGE, run.saveStaffProfile);
router.post('/staff-items', MANAGE, run.addStaffItem);
router.put('/staff-items/:id', MANAGE, run.updateStaffItem);
router.delete('/staff-items/:id', MANAGE, run.deleteStaffItem);

router.get('/loans', VIEW, run.getLoans);
router.post('/loans', MANAGE, run.addLoan);
router.put('/loans/:id', MANAGE, run.updateLoan);

router.get('/runs', VIEW, run.listRuns);
router.post('/runs', MANAGE, run.createRun);
router.get('/runs/:id', VIEW, run.getRunDetail);
router.delete('/runs/:id', MANAGE, run.deleteRun);
router.put('/runs/:id/items/:itemId', MANAGE, run.updateRunItem);
router.delete('/runs/:id/items/:itemId', MANAGE, run.removeRunItem);
router.post('/runs/:id/recalculate', MANAGE, run.recalculateRun);
router.post('/runs/:id/approve', MANAGE, run.approveRun);
router.post('/runs/:id/reopen', MANAGE, run.reopenRun);
router.post('/runs/:id/pay', MANAGE, run.payRun);
router.get('/runs/:id/payslips/:staffId', VIEW, run.getPayslip);
router.get('/runs/:id/export', VIEW, run.exportRun);

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

// Staff (employees) payroll: attendance-prorated, once per period
const staffPay = require('../controllers/staffPayrollController');
router.get('/staff-pay/summary', VIEW, staffPay.getSummary);
router.post('/staff-pay/run', VIEW, staffPay.runPayroll);
router.get('/staff-pay/history', VIEW, staffPay.getHistory);
router.get('/staff-pay/history/:id', VIEW, staffPay.getPayslip);
router.post('/staff-pay/history/:id/email', VIEW, staffPay.emailPayslip);

// POST /api/payroll/run-sales-reps
router.post('/run-sales-reps', payrollController.runSalesRepPayroll);

// GET /api/payroll/sales-reps-history?sales_rep_id=...
router.get('/sales-reps-history', payrollController.getSalesRepPayrollHistory);

// GET /api/payroll/sales-reps-history/:id  (payslip: record + deduction breakdown)
router.get('/sales-reps-history/:id', VIEW, payrollController.getSalesRepPayslip);

module.exports = router;