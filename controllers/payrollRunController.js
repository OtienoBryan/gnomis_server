const db = require('../database/db');
const { ensurePayrollSchema } = require('../services/payrollSchema');
const { calculatePayslip, round2 } = require('../services/payrollCalculator');

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const nullable = (v) => (v === undefined || v === null || v === '' ? null : v);
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const handle = (fn) => async (req, res) => {
  try {
    await ensurePayrollSchema();
    await fn(req, res);
  } catch (error) {
    console.error('Payroll error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
};

// ---------- helpers ----------

const loadRules = async (conn = db) => {
  const [rows] = await conn.query('SELECT * FROM payroll_statutory_rules WHERE is_active = 1 ORDER BY sort_order, id');
  return rows;
};

const getSettings = async (conn = db) => {
  const [rows] = await conn.query('SELECT setting_key, setting_value FROM payroll_settings');
  const out = {};
  rows.forEach((r) => { out[r.setting_key] = r.setting_value; });
  return out;
};

const SETTING_KEYS = [
  'salary_expense_account_id',
  'employer_cost_expense_account_id',
  'other_deductions_account_id',
  'staff_loans_account_id',
];

const daysInMonthOf = (year, month) => new Date(year, month, 0).getDate();

const parseBreakdown = (item) => {
  try { return item.breakdown ? JSON.parse(item.breakdown) : {}; } catch { return {}; }
};

/** Build the inputs for each staff member from salary, recurring items, loans and profile. */
const buildStaffInputs = async (conn, { staffIds, year, month }) => {
  // Employees are the SalesRep records (the "Staff" shown on the sales dashboard); status = 1 means active
  let sql = `SELECT id, name, basic_salary AS salary FROM SalesRep WHERE status = 1`;
  const params = [];
  if (Array.isArray(staffIds) && staffIds.length > 0) {
    sql += ' AND id IN (?)';
    params.push(staffIds);
  }
  const [staffRows] = await conn.query(sql, params);
  if (staffRows.length === 0) return [];
  const ids = staffRows.map((s) => s.id);

  const [profiles] = await conn.query('SELECT * FROM payroll_staff_profiles WHERE staff_id IN (?)', [ids]);
  const [items] = await conn.query('SELECT * FROM payroll_staff_items WHERE is_active = 1 AND staff_id IN (?)', [ids]);
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonthOf(year, month)).padStart(2, '0')}`;
  const [loans] = await conn.query(
    `SELECT * FROM payroll_loans WHERE status = 'active' AND balance > 0 AND start_date <= ? AND staff_id IN (?)`,
    [periodEnd, ids]
  );

  const profileBy = new Map(profiles.map((p) => [p.staff_id, p]));
  return staffRows
    .filter((s) => {
      const p = profileBy.get(s.id);
      return num(s.salary) > 0 && (!p || p.is_payroll_active);
    })
    .map((s) => {
      const p = profileBy.get(s.id);
      const mine = items.filter((i) => i.staff_id === s.id);
      return {
        staff_id: s.id,
        staff_name: s.name,
        basic: num(s.salary),
        allowances: mine.filter((i) => i.item_type === 'allowance').map((i) => ({ name: i.name, amount: num(i.amount), taxable: !!i.is_taxable })),
        deductions: mine.filter((i) => i.item_type === 'deduction').map((i) => ({ name: i.name, amount: num(i.amount) })),
        loans: loans
          .filter((l) => l.staff_id === s.id)
          .map((l) => ({ id: l.id, name: l.loan_type, amount: Math.min(num(l.monthly_installment), num(l.balance)) })),
        exemptCodes: p && p.exempt_codes ? p.exempt_codes.split(',').map((c) => c.trim()).filter(Boolean) : [],
      };
    });
};

const itemRowFromCalc = (runId, input, calc, extras) => [
  runId, input.staff_id, input.staff_name,
  calc.basic, calc.unpaid_days, calc.extra_earnings, calc.extra_deductions,
  calc.allowances_total, calc.gross_pay, calc.taxable_income, calc.paye,
  calc.statutory_employee, calc.statutory_employer, calc.other_deductions, calc.loan_deductions,
  calc.total_deductions, calc.net_pay,
  JSON.stringify({ ...calc, inputs: { basic: input.basic, allowances: input.allowances, deductions: input.deductions, loans: input.loans, exemptCodes: input.exemptCodes, daysInMonth: extras.daysInMonth } }),
];

const ITEM_COLUMNS = `(run_id, staff_id, staff_name, basic_salary, unpaid_days, extra_earnings, extra_deductions,
  allowances_total, gross_pay, taxable_income, paye, statutory_employee, statutory_employer, other_deductions,
  loan_deductions, total_deductions, net_pay, breakdown)`;

const refreshRunTotals = async (conn, runId) => {
  const [[t]] = await conn.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(gross_pay),0) AS gross, COALESCE(SUM(total_deductions),0) AS ded,
            COALESCE(SUM(net_pay),0) AS net, COALESCE(SUM(gross_pay + statutory_employer),0) AS cost
     FROM payroll_run_items WHERE run_id = ?`, [runId]);
  await conn.query(
    `UPDATE payroll_runs SET employee_count=?, total_gross=?, total_deductions=?, total_net=?, total_employer_cost=? WHERE id=?`,
    [t.cnt, t.gross, t.ded, t.net, t.cost, runId]);
};

const getRun = async (conn, id) => {
  const [[run]] = await conn.query('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  return run;
};

const toCsv = (rows) =>
  rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');

// ---------- controller ----------

const controller = {
  // ===== accounts & settings =====
  getAccounts: handle(async (req, res) => {
    const [rows] = await db.query(
      'SELECT id, account_code, account_name, account_type FROM chart_of_accounts WHERE is_active = 1 ORDER BY account_code');
    res.json({
      success: true,
      data: {
        payment: rows.filter((a) => a.account_type === 9),
        liability: rows.filter((a) => a.account_type === 10),
        expense: rows.filter((a) => a.account_type === 16 || a.account_type === 5),
        all: rows,
      },
    });
  }),

  getSettings: handle(async (req, res) => {
    res.json({ success: true, data: await getSettings() });
  }),

  updateSettings: handle(async (req, res) => {
    for (const key of SETTING_KEYS) {
      if (req.body[key] === undefined) continue;
      await db.query(
        'INSERT INTO payroll_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [key, nullable(req.body[key])]);
    }
    res.json({ success: true, data: await getSettings() });
  }),

  /** Saves ledger-account links only (settings + per-rule liability accounts), nothing else. */
  saveAccountLinks: handle(async (req, res) => {
    const { settings, rules } = req.body;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const key of SETTING_KEYS) {
        if (!settings || settings[key] === undefined) continue;
        await conn.query(
          'INSERT INTO payroll_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
          [key, nullable(settings[key])]);
      }
      for (const r of Array.isArray(rules) ? rules : []) {
        if (!r.id) continue;
        await conn.query(
          'UPDATE payroll_statutory_rules SET account_id = ?, employer_account_id = ? WHERE id = ?',
          [nullable(r.account_id), nullable(r.employer_account_id), r.id]);
      }
      await conn.commit();
      res.json({ success: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),

  // ===== statutory rules =====
  getRules: handle(async (req, res) => {
    const [rows] = await db.query(`
      SELECT r.*, a.account_code, a.account_name
      FROM payroll_statutory_rules r LEFT JOIN chart_of_accounts a ON r.account_id = a.id
      ORDER BY r.sort_order, r.id`);
    res.json({ success: true, data: rows.map((r) => ({ ...r, bands: r.bands ? JSON.parse(r.bands) : [] })) });
  }),

  saveRule: handle(async (req, res) => {
    const { id } = req.params;
    const b = req.body;
    if (!id && (!b.code || !b.name)) return fail(res, 400, 'code and name are required');
    if (b.method && !['percentage', 'flat', 'bands'].includes(b.method)) return fail(res, 400, 'Invalid method');
    if (b.method === 'bands') {
      const bands = Array.isArray(b.bands) ? b.bands : [];
      if (bands.length === 0) return fail(res, 400, 'At least one tax band is required');
      let prev = 0;
      for (let i = 0; i < bands.length; i += 1) {
        const upto = bands[i].upto === null || bands[i].upto === '' || bands[i].upto === undefined ? null : Number(bands[i].upto);
        if (upto === null && i !== bands.length - 1) return fail(res, 400, 'Only the last band can be unlimited');
        if (upto !== null && upto <= prev) return fail(res, 400, 'Band limits must be increasing');
        if (upto !== null) prev = upto;
      }
    }

    const fields = {
      code: b.code ? String(b.code).trim().toUpperCase() : undefined,
      name: b.name, description: nullable(b.description), method: b.method, base: b.base,
      employee_rate: nullable(b.employee_rate), employer_rate: nullable(b.employer_rate),
      employee_amount: nullable(b.employee_amount), employer_amount: nullable(b.employer_amount),
      min_amount: nullable(b.min_amount), max_amount: nullable(b.max_amount),
      earnings_ceiling: nullable(b.earnings_ceiling),
      bands: b.method === 'bands' ? JSON.stringify(b.bands.map((x) => ({
        upto: x.upto === '' || x.upto === undefined ? null : x.upto, rate: Number(x.rate) }))) : nullable(null),
      relief_amount: nullable(b.relief_amount),
      tax_deductible: b.tax_deductible === undefined ? undefined : (b.tax_deductible ? 1 : 0),
      account_id: nullable(b.account_id), employer_account_id: nullable(b.employer_account_id),
      sort_order: b.sort_order === undefined ? undefined : num(b.sort_order),
      is_active: b.is_active === undefined ? undefined : (b.is_active ? 1 : 0),
    };

    if (id) {
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined && (k !== 'bands' || b.method === 'bands'));
      if (keys.length === 0) return fail(res, 400, 'No fields to update');
      const [result] = await db.query(
        `UPDATE payroll_statutory_rules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((k) => fields[k]), id]);
      if (result.affectedRows === 0) return fail(res, 404, 'Rule not found');
      return res.json({ success: true });
    }

    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    try {
      const [result] = await db.query(
        `INSERT INTO payroll_statutory_rules (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map((k) => fields[k]));
      res.status(201).json({ success: true, data: { id: result.insertId } });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return fail(res, 400, `A rule with code ${fields.code} already exists`);
      throw e;
    }
  }),

  deleteRule: handle(async (req, res) => {
    const [result] = await db.query('DELETE FROM payroll_statutory_rules WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return fail(res, 404, 'Rule not found');
    res.json({ success: true });
  }),

  // Live calculator so the UI can preview what a salary produces under the current rules
  previewCalculation: handle(async (req, res) => {
    const rules = await loadRules();
    const { basic, allowances, extra_earnings, unpaid_days } = req.body;
    res.json({
      success: true,
      data: calculatePayslip({ basic: num(basic), allowances: allowances || [], extraEarnings: num(extra_earnings), unpaidDays: num(unpaid_days) }, rules),
    });
  }),

  // ===== staff payroll profiles =====
  getStaffPayroll: handle(async (req, res) => {
    const [rows] = await db.query(`
      SELECT s.*, p.kra_pin, p.nssf_no, p.shif_no, p.id_no AS profile_id_no, p.bank_name, p.bank_account, p.exempt_codes,
             COALESCE(p.is_payroll_active, 1) AS is_payroll_active,
             (SELECT COALESCE(SUM(amount),0) FROM payroll_staff_items i WHERE i.staff_id = s.id AND i.is_active = 1 AND i.item_type = 'allowance') AS allowances,
             (SELECT COALESCE(SUM(amount),0) FROM payroll_staff_items i WHERE i.staff_id = s.id AND i.is_active = 1 AND i.item_type = 'deduction') AS deductions,
             (SELECT COALESCE(SUM(balance),0) FROM payroll_loans l WHERE l.staff_id = s.id AND l.status = 'active') AS loan_balance
      FROM SalesRep s
      LEFT JOIN payroll_staff_profiles p ON p.staff_id = s.id
      WHERE s.status = 1
      ORDER BY s.name`);
    // Pick fields explicitly so nothing else on the SalesRep record is exposed
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, name: r.name, role: r.role || null, salary: r.basic_salary,
        kra_pin: r.kra_pin, nssf_no: r.nssf_no, shif_no: r.shif_no, id_no: r.profile_id_no,
        bank_name: r.bank_name, bank_account: r.bank_account, exempt_codes: r.exempt_codes,
        is_payroll_active: r.is_payroll_active, allowances: r.allowances, deductions: r.deductions, loan_balance: r.loan_balance,
      })),
    });
  }),

  getStaffPayrollDetail: handle(async (req, res) => {
    const { id } = req.params;
    const [[rep]] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [id]);
    if (!rep) return fail(res, 404, 'Staff not found');
    const staff = { id: rep.id, name: rep.name, role: rep.role || null, salary: rep.basic_salary };
    const [[profile]] = await db.query('SELECT * FROM payroll_staff_profiles WHERE staff_id = ?', [id]);
    const [items] = await db.query('SELECT * FROM payroll_staff_items WHERE staff_id = ? ORDER BY item_type, id', [id]);
    const [loans] = await db.query('SELECT * FROM payroll_loans WHERE staff_id = ? ORDER BY id DESC', [id]);
    res.json({ success: true, data: { staff, profile: profile || null, items, loans } });
  }),

  saveStaffProfile: handle(async (req, res) => {
    const { id } = req.params;
    const b = req.body;
    const [[rep]] = await db.query('SELECT id FROM SalesRep WHERE id = ?', [id]);
    if (!rep) return fail(res, 404, 'Staff not found');
    if (b.basic_salary !== undefined && b.basic_salary !== '') {
      if (num(b.basic_salary) < 0) return fail(res, 400, 'Salary cannot be negative');
      await db.query('UPDATE SalesRep SET basic_salary = ? WHERE id = ?', [num(b.basic_salary), id]);
    }
    const exempt = Array.isArray(b.exempt_codes) ? b.exempt_codes.join(',') : nullable(b.exempt_codes);
    await db.query(
      `INSERT INTO payroll_staff_profiles (staff_id, kra_pin, nssf_no, shif_no, id_no, bank_name, bank_account, exempt_codes, is_payroll_active)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE kra_pin=VALUES(kra_pin), nssf_no=VALUES(nssf_no), shif_no=VALUES(shif_no), id_no=VALUES(id_no),
         bank_name=VALUES(bank_name), bank_account=VALUES(bank_account), exempt_codes=VALUES(exempt_codes),
         is_payroll_active=VALUES(is_payroll_active)`,
      [id, nullable(b.kra_pin), nullable(b.nssf_no), nullable(b.shif_no), nullable(b.id_no), nullable(b.bank_name), nullable(b.bank_account),
        exempt, b.is_payroll_active === undefined ? 1 : (b.is_payroll_active ? 1 : 0)]);
    res.json({ success: true });
  }),

  addStaffItem: handle(async (req, res) => {
    const { staff_id, item_type, name, amount, is_taxable } = req.body;
    if (!staff_id || !['allowance', 'deduction'].includes(item_type) || !name || !(num(amount) > 0)) {
      return fail(res, 400, 'staff_id, item_type (allowance|deduction), name and a positive amount are required');
    }
    const [result] = await db.query(
      'INSERT INTO payroll_staff_items (staff_id, item_type, name, amount, is_taxable) VALUES (?,?,?,?,?)',
      [staff_id, item_type, String(name).trim(), num(amount), is_taxable === false || is_taxable === 0 ? 0 : 1]);
    res.status(201).json({ success: true, data: { id: result.insertId } });
  }),

  updateStaffItem: handle(async (req, res) => {
    const { name, amount, is_taxable, is_active } = req.body;
    const sets = []; const vals = [];
    if (name !== undefined) { sets.push('name = ?'); vals.push(String(name).trim()); }
    if (amount !== undefined) {
      if (!(num(amount) > 0)) return fail(res, 400, 'Amount must be positive');
      sets.push('amount = ?'); vals.push(num(amount));
    }
    if (is_taxable !== undefined) { sets.push('is_taxable = ?'); vals.push(is_taxable ? 1 : 0); }
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (!sets.length) return fail(res, 400, 'No fields to update');
    const [result] = await db.query(`UPDATE payroll_staff_items SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
    if (result.affectedRows === 0) return fail(res, 404, 'Item not found');
    res.json({ success: true });
  }),

  deleteStaffItem: handle(async (req, res) => {
    await db.query('DELETE FROM payroll_staff_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  }),

  // ===== loans / advances =====
  getLoans: handle(async (req, res) => {
    const [rows] = await db.query(
      `SELECT l.*, s.name AS staff_name FROM payroll_loans l JOIN SalesRep s ON s.id = l.staff_id ORDER BY l.status, l.id DESC`);
    res.json({ success: true, data: rows });
  }),

  addLoan: handle(async (req, res) => {
    const { staff_id, loan_type, principal, monthly_installment, start_date, notes } = req.body;
    if (!staff_id || !(num(principal) > 0) || !(num(monthly_installment) > 0) || !start_date) {
      return fail(res, 400, 'staff_id, principal, monthly_installment and start_date are required');
    }
    if (num(monthly_installment) > num(principal)) return fail(res, 400, 'Installment cannot exceed the principal');
    const [result] = await db.query(
      `INSERT INTO payroll_loans (staff_id, loan_type, principal, monthly_installment, balance, start_date, notes)
       VALUES (?,?,?,?,?,?,?)`,
      [staff_id, loan_type || 'Salary advance', num(principal), num(monthly_installment), num(principal), start_date, nullable(notes)]);
    res.status(201).json({ success: true, data: { id: result.insertId } });
  }),

  updateLoan: handle(async (req, res) => {
    const { monthly_installment, status } = req.body;
    const sets = []; const vals = [];
    if (monthly_installment !== undefined) {
      if (!(num(monthly_installment) > 0)) return fail(res, 400, 'Installment must be positive');
      sets.push('monthly_installment = ?'); vals.push(num(monthly_installment));
    }
    if (status !== undefined) {
      if (!['active', 'closed', 'cancelled'].includes(status)) return fail(res, 400, 'Invalid status');
      sets.push('status = ?'); vals.push(status);
    }
    if (!sets.length) return fail(res, 400, 'No fields to update');
    const [result] = await db.query(`UPDATE payroll_loans SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
    if (result.affectedRows === 0) return fail(res, 404, 'Loan not found');
    res.json({ success: true });
  }),

  // ===== payroll runs =====
  listRuns: handle(async (req, res) => {
    const [rows] = await db.query('SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC, id DESC');
    res.json({ success: true, data: rows });
  }),

  createRun: handle(async (req, res) => {
    const { year, month, pay_date, staff_ids, notes } = req.body;
    const y = Number(year); const m = Number(month);
    if (!y || !m || m < 1 || m > 12 || !pay_date) return fail(res, 400, 'year, month (1-12) and pay_date are required');

    const [dups] = await db.query(
      `SELECT id FROM payroll_runs WHERE period_year = ? AND period_month = ? AND status <> 'cancelled'`, [y, m]);
    if (dups.length > 0) return fail(res, 400, `A payroll run already exists for ${y}-${String(m).padStart(2, '0')} (run #${dups[0].id}). Cancel it first to start over.`);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const rules = await loadRules(conn);
      const inputs = await buildStaffInputs(conn, { staffIds: staff_ids, year: y, month: m });
      if (inputs.length === 0) {
        await conn.rollback();
        return fail(res, 400, 'No active staff with a salary found. Set salaries first.');
      }
      const [runResult] = await conn.query(
        'INSERT INTO payroll_runs (period_year, period_month, pay_date, notes, created_by) VALUES (?,?,?,?,?)',
        [y, m, pay_date, nullable(notes), req.user?.id || null]);
      const runId = runResult.insertId;
      const dim = daysInMonthOf(y, m);
      const rows = inputs.map((inp) =>
        itemRowFromCalc(runId, inp, calculatePayslip({ ...inp, daysInMonth: dim }, rules), { daysInMonth: dim }));
      await conn.query(`INSERT INTO payroll_run_items ${ITEM_COLUMNS} VALUES ?`, [rows]);
      await refreshRunTotals(conn, runId);
      await conn.commit();
      res.status(201).json({ success: true, data: { id: runId } });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),

  getRunDetail: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    const [items] = await db.query('SELECT * FROM payroll_run_items WHERE run_id = ? ORDER BY staff_name', [run.id]);
    const parsed = items.map((i) => { const b = parseBreakdown(i); return { ...i, breakdown: undefined, statutory: b.statutory || [], warning: b.warning || null }; });

    // Totals per statutory rule
    const totals = {};
    parsed.forEach((i) => i.statutory.forEach((s) => {
      const t = totals[s.code] || (totals[s.code] = { code: s.code, name: s.name, employee: 0, employer: 0 });
      t.employee = round2(t.employee + s.employee);
      t.employer = round2(t.employer + s.employer);
    }));
    res.json({ success: true, data: { run, items: parsed, statutory_totals: Object.values(totals) } });
  }),

  updateRunItem: handle(async (req, res) => {
    const { id, itemId } = req.params;
    const run = await getRun(db, id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'draft') return fail(res, 400, 'Only draft runs can be edited. Re-open the run first.');
    const [[item]] = await db.query('SELECT * FROM payroll_run_items WHERE id = ? AND run_id = ?', [itemId, id]);
    if (!item) return fail(res, 404, 'Payroll item not found');

    const { unpaid_days, extra_earnings, extra_deductions } = req.body;
    const unpaid = unpaid_days === undefined ? num(item.unpaid_days) : num(unpaid_days);
    const earn = extra_earnings === undefined ? num(item.extra_earnings) : num(extra_earnings);
    const ded = extra_deductions === undefined ? num(item.extra_deductions) : num(extra_deductions);
    if (unpaid < 0 || earn < 0 || ded < 0) return fail(res, 400, 'Values cannot be negative');

    const inputs = parseBreakdown(item).inputs;
    if (!inputs) return fail(res, 400, 'Item has no calculation snapshot; recalculate the run');
    const rules = await loadRules();
    const calc = calculatePayslip({ ...inputs, unpaidDays: unpaid, extraEarnings: earn, extraDeductions: ded }, rules);
    const [row] = [itemRowFromCalc(run.id, { staff_id: item.staff_id, staff_name: item.staff_name, ...inputs }, calc, { daysInMonth: inputs.daysInMonth })];
    await db.query(
      `UPDATE payroll_run_items SET basic_salary=?, unpaid_days=?, extra_earnings=?, extra_deductions=?, allowances_total=?, gross_pay=?,
         taxable_income=?, paye=?, statutory_employee=?, statutory_employer=?, other_deductions=?, loan_deductions=?,
         total_deductions=?, net_pay=?, breakdown=? WHERE id=?`,
      [...row.slice(3), item.id]);
    await refreshRunTotals(db, run.id);
    res.json({ success: true });
  }),

  removeRunItem: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'draft') return fail(res, 400, 'Only draft runs can be edited');
    await db.query('DELETE FROM payroll_run_items WHERE id = ? AND run_id = ?', [req.params.itemId, run.id]);
    await refreshRunTotals(db, run.id);
    res.json({ success: true });
  }),

  recalculateRun: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'draft') return fail(res, 400, 'Only draft runs can be recalculated');
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [existing] = await conn.query('SELECT staff_id, unpaid_days, extra_earnings, extra_deductions FROM payroll_run_items WHERE run_id = ?', [run.id]);
      const adjustments = new Map(existing.map((e) => [e.staff_id, e]));
      const rules = await loadRules(conn);
      const inputs = await buildStaffInputs(conn, { staffIds: existing.map((e) => e.staff_id), year: run.period_year, month: run.period_month });
      const dim = daysInMonthOf(run.period_year, run.period_month);
      await conn.query('DELETE FROM payroll_run_items WHERE run_id = ?', [run.id]);
      if (inputs.length > 0) {
        const rows = inputs.map((inp) => {
          const adj = adjustments.get(inp.staff_id) || {};
          const calc = calculatePayslip({ ...inp, daysInMonth: dim, unpaidDays: num(adj.unpaid_days), extraEarnings: num(adj.extra_earnings), extraDeductions: num(adj.extra_deductions) }, rules);
          return itemRowFromCalc(run.id, inp, calc, { daysInMonth: dim });
        });
        await conn.query(`INSERT INTO payroll_run_items ${ITEM_COLUMNS} VALUES ?`, [rows]);
      }
      await refreshRunTotals(conn, run.id);
      await conn.commit();
      res.json({ success: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),

  approveRun: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'draft') return fail(res, 400, `Run is already ${run.status}`);
    const [items] = await db.query('SELECT staff_name, net_pay FROM payroll_run_items WHERE run_id = ?', [run.id]);
    if (items.length === 0) return fail(res, 400, 'Run has no employees');
    const negative = items.filter((i) => num(i.net_pay) < 0).map((i) => i.staff_name);
    if (negative.length) return fail(res, 400, `Net pay is negative for: ${negative.join(', ')}. Adjust deductions before approving.`);
    await db.query(`UPDATE payroll_runs SET status='approved', approved_by=?, approved_at=NOW() WHERE id=?`, [req.user?.id || null, run.id]);
    res.json({ success: true });
  }),

  reopenRun: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'approved') return fail(res, 400, 'Only approved runs can be re-opened');
    await db.query(`UPDATE payroll_runs SET status='draft', approved_by=NULL, approved_at=NULL WHERE id=?`, [run.id]);
    res.json({ success: true });
  }),

  /** Mark as paid: posts one balanced journal entry and reduces loan balances. */
  payRun: handle(async (req, res) => {
    const { payment_account_id, pay_date } = req.body;
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status !== 'approved') return fail(res, 400, 'Only approved runs can be paid');
    if (!payment_account_id) return fail(res, 400, 'payment_account_id is required');

    const [[pay]] = await db.query('SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 9 AND is_active = 1', [payment_account_id]);
    if (!pay) return fail(res, 400, 'payment_account_id must be an active cash/bank account');

    const settings = await getSettings();
    const rules = await loadRules();
    const ruleBy = new Map(rules.map((r) => [r.id, r]));
    const [items] = await db.query('SELECT * FROM payroll_run_items WHERE run_id = ?', [run.id]);

    let gross = 0; let net = 0; let other = 0; let loanTotal = 0; let employerTotal = 0;
    const creditsByAccount = new Map();
    const missing = new Set();
    const addCredit = (accountId, amount, label) => {
      if (amount <= 0) return;
      if (!accountId) { missing.add(label); return; }
      creditsByAccount.set(accountId, round2((creditsByAccount.get(accountId) || 0) + amount));
    };
    const statutoryTotals = new Map();
    const loanPayments = [];

    items.forEach((it) => {
      gross = round2(gross + num(it.gross_pay));
      net = round2(net + num(it.net_pay));
      other = round2(other + num(it.other_deductions));
      loanTotal = round2(loanTotal + num(it.loan_deductions));
      const b = parseBreakdown(it);
      (b.statutory || []).forEach((s) => {
        const key = s.rule_id;
        const t = statutoryTotals.get(key) || { employee: 0, employer: 0, code: s.code };
        t.employee = round2(t.employee + s.employee);
        t.employer = round2(t.employer + s.employer);
        statutoryTotals.set(key, t);
        employerTotal = round2(employerTotal + s.employer);
      });
      (b.loans || []).forEach((l) => loanPayments.push(l));
    });

    for (const [ruleId, t] of statutoryTotals) {
      const rule = ruleBy.get(ruleId);
      const empAccount = rule ? rule.account_id : null;
      const erAccount = rule ? (rule.employer_account_id || rule.account_id) : null;
      addCredit(empAccount, t.employee, `${t.code} liability account`);
      addCredit(erAccount, t.employer, `${t.code} liability account`);
    }
    addCredit(settings.other_deductions_account_id && Number(settings.other_deductions_account_id), other, 'Other deductions payable account');
    addCredit(settings.staff_loans_account_id && Number(settings.staff_loans_account_id), loanTotal, 'Staff loans receivable account');

    const salaryExpense = Number(settings.salary_expense_account_id) || null;
    const employerExpense = Number(settings.employer_cost_expense_account_id) || salaryExpense;
    if (!salaryExpense) missing.add('Salaries expense account');
    if (employerTotal > 0 && !employerExpense) missing.add('Employer contributions expense account');
    if (missing.size) {
      return fail(res, 400, `Link these accounts under Payroll Settings first: ${[...missing].join(', ')}`);
    }

    const debits = [{ account: salaryExpense, amount: gross, text: 'Gross salaries' }];
    if (employerTotal > 0) debits.push({ account: employerExpense, amount: employerTotal, text: 'Employer statutory contributions' });
    const credits = [{ account: Number(payment_account_id), amount: net, text: 'Net pay' }];
    for (const [account, amount] of creditsByAccount) credits.push({ account, amount, text: 'Payroll deductions and contributions payable' });

    const totalDebit = round2(debits.reduce((s, d) => s + d.amount, 0));
    const totalCredit = round2(credits.reduce((s, c) => s + c.amount, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return fail(res, 500, `Journal does not balance (debit ${totalDebit}, credit ${totalCredit}). Nothing was posted.`);
    }

    const monthLabel = `${run.period_year}-${String(run.period_month).padStart(2, '0')}`;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Re-check status inside the transaction to prevent double-posting
      const [[locked]] = await conn.query('SELECT status FROM payroll_runs WHERE id = ? FOR UPDATE', [run.id]);
      if (locked.status !== 'approved') { await conn.rollback(); return fail(res, 400, 'Run was already processed'); }

      const [je] = await conn.query(
        `INSERT INTO journal_entries (entry_number, entry_date, reference, description, total_debit, total_credit, status, created_by)
         VALUES (?,?,?,?,?,?,'posted',?)`,
        [`JE-PR-${run.id}-${Date.now().toString(36).slice(-5)}`, pay_date || run.pay_date, `PAYROLL-${monthLabel}`,
          `Payroll for ${monthLabel} (${items.length} employees)`, totalDebit, totalCredit, req.user?.id || 1]);
      for (const d of debits) {
        await conn.query(
          'INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (?,?,?,0,?)',
          [je.insertId, d.account, d.amount, `${d.text} ${monthLabel}`]);
      }
      for (const c of credits) {
        await conn.query(
          'INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (?,?,0,?,?)',
          [je.insertId, c.account, c.amount, `${c.text} ${monthLabel}`]);
      }

      // MySQL evaluates SET left-to-right, so `status` sees the already-reduced balance.
      for (const l of loanPayments) {
        await conn.query(
          `UPDATE payroll_loans SET balance = GREATEST(balance - ?, 0), status = IF(balance <= 0.004, 'closed', status) WHERE id = ?`,
          [l.amount, l.id]);
      }
      await conn.query(
        `UPDATE payroll_runs SET status='paid', paid_at=NOW(), payment_account_id=?, journal_entry_id=?, pay_date=? WHERE id=?`,
        [payment_account_id, je.insertId, pay_date || run.pay_date, run.id]);
      await conn.commit();
      res.json({ success: true, data: { journal_entry_id: je.insertId } });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),

  deleteRun: handle(async (req, res) => {
    const run = await getRun(db, req.params.id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    if (run.status === 'paid') return fail(res, 400, 'A paid run has posted journal entries and cannot be deleted');
    if (run.status === 'draft') {
      await db.query('DELETE FROM payroll_runs WHERE id = ?', [run.id]);
    } else {
      await db.query(`UPDATE payroll_runs SET status='cancelled' WHERE id=?`, [run.id]);
    }
    res.json({ success: true });
  }),

  // ===== payslips & exports =====
  getPayslip: handle(async (req, res) => {
    const { id, staffId } = req.params;
    const run = await getRun(db, id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    const [[item]] = await db.query('SELECT * FROM payroll_run_items WHERE run_id = ? AND staff_id = ?', [id, staffId]);
    if (!item) return fail(res, 404, 'Payslip not found');
    const [[rep]] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [staffId]);
    const empNo = `EMP${String(staffId).padStart(3, '0')}`;
    const staff = rep
      ? { id: rep.id, name: rep.name, role: rep.role || null, employee_number: rep.employee_number || empNo, department: rep.department || 'Sales' }
      : { id: staffId, name: item.staff_name, employee_number: empNo, department: 'Sales' };
    const [[profile]] = await db.query('SELECT kra_pin, nssf_no, shif_no, id_no, bank_name, bank_account FROM payroll_staff_profiles WHERE staff_id = ?', [staffId]);
    const b = parseBreakdown(item);
    res.json({ success: true, data: { run, staff, profile: profile || {}, payslip: { ...b, inputs: undefined } } });
  }),

  exportRun: handle(async (req, res) => {
    const { id } = req.params;
    const type = String(req.query.type || 'summary');
    const run = await getRun(db, id);
    if (!run) return fail(res, 404, 'Payroll run not found');
    const [items] = await db.query(
      `SELECT i.*, p.id_no, p.kra_pin, p.nssf_no, p.shif_no, p.bank_name, p.bank_account
       FROM payroll_run_items i
       LEFT JOIN payroll_staff_profiles p ON p.staff_id = i.staff_id
       WHERE i.run_id = ? ORDER BY i.staff_name`, [id]);

    let rows; let name;
    if (type === 'bank') {
      name = 'bank-schedule';
      rows = [['Employee', 'Bank', 'Account No', 'Net Pay']];
      items.forEach((i) => rows.push([i.staff_name, i.bank_name, i.bank_account, i.net_pay]));
    } else if (type.startsWith('statutory:')) {
      const code = type.split(':')[1].toUpperCase();
      name = code.toLowerCase();
      rows = [['Employee', 'ID No', 'KRA PIN', 'NSSF No', 'SHIF No', 'Gross Pay', 'Taxable Income', `${code} Employee`, `${code} Employer`]];
      items.forEach((i) => {
        const s = (parseBreakdown(i).statutory || []).find((x) => String(x.code).toUpperCase() === code);
        if (s && (s.employee > 0 || s.employer > 0)) {
          rows.push([i.staff_name, i.id_no, i.kra_pin, i.nssf_no, i.shif_no, i.gross_pay, i.taxable_income, s.employee, s.employer]);
        }
      });
    } else {
      name = 'payroll-summary';
      rows = [['Employee', 'Basic', 'Allowances', 'Extra Earnings', 'Gross Pay', 'PAYE', 'Other Statutory (Employee)', 'Other Deductions', 'Loans', 'Total Deductions', 'Net Pay', 'Employer Contributions']];
      items.forEach((i) => rows.push([i.staff_name, i.basic_salary, i.allowances_total, i.extra_earnings, i.gross_pay, i.paye,
        round2(num(i.statutory_employee) - num(i.paye)), i.other_deductions, i.loan_deductions, i.total_deductions, i.net_pay, i.statutory_employer]));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${run.period_year}-${String(run.period_month).padStart(2, '0')}.csv"`);
    res.send(toCsv(rows));
  }),
};

module.exports = controller;
