const db = require('../database/db');

/**
 * Idempotent creation of the payroll tables + seed of default (editable) Kenyan statutory rules.
 * Called lazily by the payroll controller (once per process) and by database/setup_payroll_v2.js.
 */

const DEFAULT_PAYE_BANDS = [
  { upto: 24000, rate: 10 },
  { upto: 32333, rate: 25 },
  { upto: 500000, rate: 30 },
  { upto: 800000, rate: 32.5 },
  { upto: null, rate: 35 },
];

const DEFAULT_RULES = [
  {
    code: 'PAYE', name: 'PAYE (Income Tax)', method: 'bands', base: 'taxable',
    bands: DEFAULT_PAYE_BANDS, relief_amount: 2400, tax_deductible: 0, sort_order: 90,
    description: 'Progressive income tax on taxable pay (after NSSF, SHIF and Housing Levy), less personal relief.',
  },
  {
    code: 'NSSF', name: 'NSSF', method: 'percentage', base: 'gross',
    employee_rate: 6, employer_rate: 6, earnings_ceiling: 108000, tax_deductible: 1, sort_order: 10,
    description: '6% of pensionable pay up to the upper earnings limit, matched by the employer.',
  },
  {
    code: 'SHIF', name: 'SHIF (Social Health Insurance)', method: 'percentage', base: 'gross',
    employee_rate: 2.75, employer_rate: 0, min_amount: 300, tax_deductible: 1, sort_order: 20,
    description: '2.75% of gross pay, minimum KES 300.',
  },
  {
    code: 'AHL', name: 'Affordable Housing Levy', method: 'percentage', base: 'gross',
    employee_rate: 1.5, employer_rate: 1.5, tax_deductible: 1, sort_order: 30,
    description: '1.5% of gross pay, matched by the employer.',
  },
  {
    code: 'NITA', name: 'NITA Levy', method: 'flat', base: 'gross',
    employee_amount: 0, employer_amount: 50, tax_deductible: 0, sort_order: 40,
    description: 'KES 50 per employee per month, paid by the employer.',
  },
];

let ready = null;

const createTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      setting_key VARCHAR(60) PRIMARY KEY,
      setting_value VARCHAR(255) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_statutory_rules (
      id INT PRIMARY KEY AUTO_INCREMENT,
      code VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      method ENUM('percentage','flat','bands') NOT NULL DEFAULT 'percentage',
      base ENUM('gross','basic','taxable') NOT NULL DEFAULT 'gross',
      employee_rate DECIMAL(8,4) NULL,
      employer_rate DECIMAL(8,4) NULL,
      employee_amount DECIMAL(12,2) NULL,
      employer_amount DECIMAL(12,2) NULL,
      min_amount DECIMAL(12,2) NULL,
      max_amount DECIMAL(12,2) NULL,
      earnings_ceiling DECIMAL(12,2) NULL,
      bands TEXT NULL,
      relief_amount DECIMAL(12,2) NULL,
      tax_deductible TINYINT(1) NOT NULL DEFAULT 0,
      account_id INT NULL,
      employer_account_id INT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_staff_profiles (
      staff_id INT PRIMARY KEY,
      kra_pin VARCHAR(20) NULL,
      nssf_no VARCHAR(30) NULL,
      shif_no VARCHAR(30) NULL,
      id_no VARCHAR(30) NULL,
      bank_name VARCHAR(100) NULL,
      bank_account VARCHAR(50) NULL,
      exempt_codes VARCHAR(255) NULL,
      is_payroll_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Tables created before id_no existed need the column added
  try {
    await db.query('ALTER TABLE payroll_staff_profiles ADD COLUMN id_no VARCHAR(30) NULL AFTER shif_no');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_staff_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      staff_id INT NOT NULL,
      item_type ENUM('allowance','deduction') NOT NULL,
      name VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      is_taxable TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_staff_items_staff (staff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_loans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      staff_id INT NOT NULL,
      loan_type VARCHAR(50) NOT NULL DEFAULT 'Salary advance',
      principal DECIMAL(12,2) NOT NULL,
      monthly_installment DECIMAL(12,2) NOT NULL,
      balance DECIMAL(12,2) NOT NULL,
      start_date DATE NOT NULL,
      status ENUM('active','closed','cancelled') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_loans_staff (staff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sales_rep_deductions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sales_rep_id INT NOT NULL,
      reference VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      deduction_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rep_deductions_rep (sales_rep_id),
      INDEX idx_rep_deductions_date (deduction_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Tables created before status existed need the column added
  try {
    await db.query("ALTER TABLE sales_rep_deductions ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER deduction_date");
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  for (const ddl of [
    'ALTER TABLE sales_rep_deductions ADD COLUMN reviewed_by INT NULL',
    'ALTER TABLE sales_rep_deductions ADD COLUMN reviewed_at DATETIME NULL',
    // Set once the deduction has been posted to the ledger by a sales rep payroll run
    'ALTER TABLE sales_rep_deductions ADD COLUMN journal_entry_id INT NULL',
  ]) {
    try {
      await db.query(ddl);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
  }

  // Salary advances given to sales reps. Approved advances are recovered from payroll until recovered_amount = amount.
  await db.query(`
    CREATE TABLE IF NOT EXISTS sales_rep_advances (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sales_rep_id INT NOT NULL,
      reference VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      recovered_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      advance_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_by INT NULL,
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rep_advances_rep (sales_rep_id),
      INDEX idx_rep_advances_date (advance_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Each payroll run that recovers part (or all) of an advance
  await db.query(`
    CREATE TABLE IF NOT EXISTS sales_rep_advance_recoveries (
      id INT PRIMARY KEY AUTO_INCREMENT,
      advance_id INT NOT NULL,
      sales_rep_id INT NOT NULL,
      journal_entry_id INT NULL,
      amount DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_advance_recoveries_advance (advance_id),
      INDEX idx_advance_recoveries_journal (journal_entry_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Salary advances given to staff (employees). Approved advances are recovered from staff payroll.
  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_advances (
      id INT PRIMARY KEY AUTO_INCREMENT,
      staff_id INT NOT NULL,
      reference VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      recovered_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      advance_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_by INT NULL,
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_staff_advances_staff (staff_id),
      INDEX idx_staff_advances_date (advance_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_advance_recoveries (
      id INT PRIMARY KEY AUTO_INCREMENT,
      advance_id INT NOT NULL,
      staff_id INT NOT NULL,
      journal_entry_id INT NULL,
      amount DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_staff_advance_recoveries_advance (advance_id),
      INDEX idx_staff_advance_recoveries_journal (journal_entry_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Unpaid leave (or the part of a leave beyond the staff member's balance) is not paid by staff payroll
  try {
    await db.query('ALTER TABLE leave_requests ADD COLUMN is_unpaid TINYINT(1) NOT NULL DEFAULT 0');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  // Payroll posted for employees in the staff table (attendance-prorated, once per period)
  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_payroll_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      staff_id INT NOT NULL,
      pay_date DATE NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      working_days INT NOT NULL DEFAULT 0,
      days_paid DECIMAL(8,2) NOT NULL DEFAULT 0,
      gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
      journal_entry_id INT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_staff_payroll_staff (staff_id),
      INDEX idx_staff_payroll_period (period_start, period_end)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      period_year INT NOT NULL,
      period_month INT NOT NULL,
      pay_date DATE NOT NULL,
      status ENUM('draft','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
      payment_account_id INT NULL,
      journal_entry_id INT NULL,
      total_gross DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_deductions DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_net DECIMAL(15,2) NOT NULL DEFAULT 0,
      total_employer_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      employee_count INT NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by INT NULL,
      approved_by INT NULL,
      approved_at DATETIME NULL,
      paid_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_runs_period (period_year, period_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_run_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      run_id INT NOT NULL,
      staff_id INT NOT NULL,
      staff_name VARCHAR(255) NULL,
      basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      unpaid_days DECIMAL(5,2) NOT NULL DEFAULT 0,
      extra_earnings DECIMAL(12,2) NOT NULL DEFAULT 0,
      extra_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      allowances_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
      taxable_income DECIMAL(12,2) NOT NULL DEFAULT 0,
      paye DECIMAL(12,2) NOT NULL DEFAULT 0,
      statutory_employee DECIMAL(12,2) NOT NULL DEFAULT 0,
      statutory_employer DECIMAL(12,2) NOT NULL DEFAULT 0,
      other_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      loan_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
      breakdown LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_run_staff (run_id, staff_id),
      INDEX idx_items_staff (staff_id),
      CONSTRAINT fk_payroll_items_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

const seedRules = async () => {
  const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM payroll_statutory_rules');
  if (c > 0) return;
  for (const r of DEFAULT_RULES) {
    await db.query(
      `INSERT INTO payroll_statutory_rules
        (code, name, description, method, base, employee_rate, employer_rate, employee_amount, employer_amount,
         min_amount, max_amount, earnings_ceiling, bands, relief_amount, tax_deductible, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.code, r.name, r.description || null, r.method, r.base,
        r.employee_rate ?? null, r.employer_rate ?? null, r.employee_amount ?? null, r.employer_amount ?? null,
        r.min_amount ?? null, r.max_amount ?? null, r.earnings_ceiling ?? null,
        r.bands ? JSON.stringify(r.bands) : null, r.relief_amount ?? null, r.tax_deductible ? 1 : 0, r.sort_order,
      ]
    );
  }
};

const ensurePayrollSchema = () => {
  if (!ready) {
    ready = (async () => {
      await createTables();
      await seedRules();
    })().catch((err) => {
      ready = null; // allow retry on next request
      throw err;
    });
  }
  return ready;
};

module.exports = { ensurePayrollSchema };
