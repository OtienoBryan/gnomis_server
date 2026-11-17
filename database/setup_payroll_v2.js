// Optional manual setup: node database/setup_payroll_v2.js
// (the payroll API also does this automatically on first request)
const { ensurePayrollSchema } = require('../services/payrollSchema');

ensurePayrollSchema()
  .then(() => { console.log('Payroll tables ready and default statutory rules seeded.'); process.exit(0); })
  .catch((err) => { console.error('Payroll setup failed:', err); process.exit(1); });
