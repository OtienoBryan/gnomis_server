const db = require('../database/db');
const { ensurePayrollSchema } = require('../services/payrollSchema');

// ---- Staff payroll (employees in the `staff` table) ----
// Works like the sales rep payroll: pay is prorated by attendance (days present + approved leave,
// out of the working days in the period - every day up to today except Sundays), the active
// payroll_deductions are applied, and one balanced journal entry is posted per employee:
//   Debit  expense account      = gross pay
//   Credit payment account      = net pay
//   Credit each deduction's linked liability account = deduction amount
// An employee can only be paid once per period.

const isoDay = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const countWorkingDays = (start, end) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  let count = 0;
  for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
    if (d <= today && d.getDay() !== 0) count++;
  }
  return count;
};

const deductionAmount = (deduction, gross) => {
  let value = deduction.calculation_type === 'percentage'
    ? gross * (Number(deduction.rate || 0) / 100)
    : Number(deduction.amount || 0);
  if (deduction.cap_amount != null && value > Number(deduction.cap_amount)) value = Number(deduction.cap_amount);
  return value;
};

const round2 = (n) => Math.round(n * 100) / 100;

// Distinct non-Sunday days with a check-in per staff member (both attendance tables), plus approved leave days
const loadDays = async (conn, staffIds, start, end) => {
  const presentByStaff = {};
  const leaveByStaff = {};
  if (staffIds.length === 0) return { presentByStaff, leaveByStaff };

  const addDay = (id, day) => {
    const s = String(day).slice(0, 10);
    const dt = new Date(`${s}T00:00:00`);
    if (isNaN(dt.getTime()) || dt.getDay() === 0) return;
    (presentByStaff[id] = presentByStaff[id] || new Set()).add(s);
  };

  const [a1] = await conn.query(
    `SELECT user_id AS id, date FROM staff_attendance
     WHERE user_id IN (?) AND date BETWEEN ? AND ? AND checkin_time IS NOT NULL AND checkin_time <> '' AND checkin_time <> 'NULL'`,
    [staffIds, start, end]
  );
  a1.forEach(r => addDay(r.id, r.date));

  const [a2] = await conn.query(
    `SELECT staff_id AS id, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM attendance
     WHERE staff_id IN (?) AND date BETWEEN ? AND ? AND checkin_time IS NOT NULL`,
    [staffIds, start, end]
  );
  a2.forEach(r => addDay(r.id, r.date));

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const rangeStart = new Date(`${start}T00:00:00`);
  const rangeEnd = new Date(`${end}T00:00:00`);
  const [leaves] = await conn.query(
    `SELECT employee_id AS id, start_date, end_date FROM leave_requests
     WHERE employee_id IN (?) AND (salesrep IS NULL OR salesrep = 0)
     AND CAST(status AS UNSIGNED) = 1 AND start_date <= ? AND end_date >= ?`,
    [staffIds, end, start]
  );
  leaves.forEach(lv => {
    const ls = new Date(lv.start_date) < rangeStart ? rangeStart : new Date(lv.start_date);
    const le = new Date(lv.end_date) > rangeEnd ? rangeEnd : new Date(lv.end_date);
    let count = 0;
    for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
      if (d >= rangeStart && d <= rangeEnd && d <= today && d.getDay() !== 0) count++;
    }
    leaveByStaff[lv.id] = (leaveByStaff[lv.id] || 0) + count;
  });
  return { presentByStaff, leaveByStaff };
};

const computePay = (staff, presentSet, leaveDays, numWorkingDays, deductions) => {
  const present = presentSet ? presentSet.size : 0;
  const basic = staff.salary != null ? Number(staff.salary) : 0;
  const daysPaid = Math.min(numWorkingDays || 0, present + (leaveDays || 0)) || present + (leaveDays || 0);
  const gross = numWorkingDays > 0 ? basic * (daysPaid / numWorkingDays) : basic;
  const lines = deductions
    .map(d => ({ id: d.id, name: d.name, account_id: d.account_id, amount: round2(deductionAmount(d, gross)) }))
    .filter(l => l.amount > 0);
  let totalDeductions = lines.reduce((s, l) => s + l.amount, 0);
  if (totalDeductions > gross) totalDeductions = gross; // deductions can't exceed gross pay
  return {
    present, leave: leaveDays || 0, daysPaid, basic_salary: basic,
    gross_pay: round2(gross), deductions: lines, total_deductions: round2(totalDeductions),
    net_pay: round2(gross - totalDeductions),
  };
};

const staffPayrollController = {
  // Staff with their attendance-based pay for a period, and whether they were already paid for it
  getSummary: async (req, res) => {
    try {
      await ensurePayrollSchema();
      const now = new Date();
      const start = req.query.start || isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const end = req.query.end || isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      const status = req.query.status;

      let sql = 'SELECT id, name, role, designation, department, empl_no, salary, status FROM staff';
      const params = [];
      if (status !== undefined && status !== '') { sql += ' WHERE status = ?'; params.push(status); }
      sql += ' ORDER BY name';
      const [staff] = await db.query(sql, params);

      const ids = staff.map(s => s.id);
      const numWorkingDays = countWorkingDays(start, end);
      const { presentByStaff, leaveByStaff } = await loadDays(db, ids, start, end);
      const [deductions] = await db.query('SELECT * FROM payroll_deductions WHERE is_active = 1');

      let paidIds = new Set();
      if (ids.length) {
        const [paid] = await db.query(
          'SELECT staff_id FROM staff_payroll_history WHERE staff_id IN (?) AND period_start <= ? AND period_end >= ?',
          [ids, end, start]
        );
        paidIds = new Set(paid.map(p => p.staff_id));
      }

      const data = staff.map(s => ({
        id: s.id, name: s.name, role: s.role, designation: s.designation, department: s.department,
        empl_no: s.empl_no, status: s.status,
        working_days: numWorkingDays,
        already_paid: paidIds.has(s.id),
        ...computePay(s, presentByStaff[s.id], leaveByStaff[s.id], numWorkingDays, deductions),
      }));
      res.json({ success: true, data, period: { start, end, working_days: numWorkingDays } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  runPayroll: async (req, res) => {
    try {
      await ensurePayrollSchema();
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { pay_date, period_start, period_end, staff_ids, payment_account_id, expense_account_id, notes } = req.body;

      if (!pay_date || !period_start || !period_end) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'pay_date, period_start and period_end are required' });
      }
      if (!payment_account_id || !expense_account_id) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'payment_account_id and expense_account_id are required' });
      }
      const [pay] = await connection.query(
        'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 9 AND is_active = 1', [payment_account_id]);
      if (pay.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'payment_account_id must reference an active cash/bank account (account_type = 9)' });
      }
      const [exp] = await connection.query(
        'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 16 AND is_active = 1', [expense_account_id]);
      if (exp.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'expense_account_id must reference an active expense account (account_type = 16)' });
      }

      let q = 'SELECT id, name, salary FROM staff';
      const p = [];
      if (Array.isArray(staff_ids) && staff_ids.length > 0) { q += ' WHERE id IN (?)'; p.push(staff_ids); }
      else q += ' WHERE status = 1';
      const [staffList] = await connection.query(q, p);
      if (staffList.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'No staff found for payroll' });
      }

      // One payroll per staff member per period (or per pay date)
      const [existing] = await connection.query(
        `SELECT staff_id FROM staff_payroll_history
         WHERE staff_id IN (?) AND ((period_start <= ? AND period_end >= ?) OR pay_date = ?)
         FOR UPDATE`,
        [staffList.map(s => s.id), period_end, period_start, pay_date]
      );
      const alreadyPaid = new Set(existing.map(e => e.staff_id));
      const pending = staffList.filter(s => !alreadyPaid.has(s.id));
      if (pending.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: 'Payroll has already been run for all selected staff for this period. A staff member can only be paid once per period.',
        });
      }

      const numWorkingDays = countWorkingDays(period_start, period_end);
      const { presentByStaff, leaveByStaff } = await loadDays(connection, pending.map(s => s.id), period_start, period_end);
      const [deductions] = await connection.query('SELECT * FROM payroll_deductions WHERE is_active = 1');

      let processed = 0;
      const results = [];
      for (const s of pending) {
        const c = computePay(s, presentByStaff[s.id], leaveByStaff[s.id], numWorkingDays, deductions);
        if (c.basic_salary <= 0 || c.gross_pay <= 0) continue;

        const [je] = await connection.query(
          `INSERT INTO journal_entries (entry_number, entry_date, reference, description, total_debit, total_credit, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`,
          [
            `JE-STAFF-PAYROLL-${s.id}-${Date.now()}`, pay_date, `STAFF-PAYROLL-${s.id}`,
            `Staff payroll for ${s.name} (${period_start} to ${period_end})`,
            c.gross_pay, c.gross_pay, req.user?.id || 1,
          ]
        );
        const jeId = je.insertId;
        let line = 1;
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
           VALUES (?, ?, ?, 0, ?, ?)`,
          [jeId, expense_account_id, c.gross_pay, `Gross payroll for ${s.name}`, line++]
        );
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
           VALUES (?, ?, 0, ?, ?, ?)`,
          [jeId, payment_account_id, c.net_pay, `Net pay for ${s.name}`, line++]
        );
        for (const d of c.deductions) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
             VALUES (?, ?, 0, ?, ?, ?)`,
            [jeId, d.account_id, d.amount, `${d.name} for ${s.name}`, line++]
          );
        }
        await connection.query(
          `INSERT INTO staff_payroll_history
           (staff_id, pay_date, period_start, period_end, basic_salary, working_days, days_paid, gross_pay, total_deductions, net_pay, journal_entry_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.id, pay_date, period_start, period_end, c.basic_salary, numWorkingDays, c.daysPaid, c.gross_pay, c.total_deductions, c.net_pay, jeId, notes || null]
        );
        processed++;
        results.push({ staff_id: s.id, name: s.name, gross_pay: c.gross_pay, total_deductions: c.total_deductions, net_pay: c.net_pay, journal_entry_id: jeId });
      }

      if (processed === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'No staff had a positive salary/gross pay to process.' });
      }
      await connection.commit();
      res.json({ success: true, message: 'Staff payroll processed', count: processed, skipped: staffList.length - pending.length, results });
    } catch (error) {
      await connection.rollback();
      res.status(500).json({ success: false, error: error.message });
    } finally {
      connection.release();
    }
  },

  getHistory: async (req, res) => {
    try {
      await ensurePayrollSchema();
      let sql = `
        SELECT h.*, s.name AS staff_name, s.role AS staff_role, s.department AS staff_department,
          DATE_FORMAT(h.pay_date, '%Y-%m-%d') AS pay_date,
          DATE_FORMAT(h.period_start, '%Y-%m-%d') AS period_start,
          DATE_FORMAT(h.period_end, '%Y-%m-%d') AS period_end
        FROM staff_payroll_history h
        JOIN staff s ON h.staff_id = s.id
      `;
      const params = [];
      if (req.query.staff_id) { sql += ' WHERE h.staff_id = ?'; params.push(req.query.staff_id); }
      sql += ' ORDER BY h.pay_date DESC, h.id DESC';
      const [rows] = await db.query(sql, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  getPayslip: async (req, res) => {
    try {
      await ensurePayrollSchema();
      const [[record]] = await db.query(
        `SELECT h.*, s.name AS staff_name, s.role AS staff_role, s.designation AS staff_designation,
                s.department AS staff_department, s.empl_no AS staff_empl_no, s.business_email AS staff_email,
                s.phone_number AS staff_phone,
                DATE_FORMAT(h.pay_date, '%Y-%m-%d') AS pay_date,
                DATE_FORMAT(h.period_start, '%Y-%m-%d') AS period_start,
                DATE_FORMAT(h.period_end, '%Y-%m-%d') AS period_end
         FROM staff_payroll_history h JOIN staff s ON h.staff_id = s.id WHERE h.id = ?`,
        [req.params.id]
      );
      if (!record) return res.status(404).json({ success: false, error: 'Payslip not found' });

      let deductions = [];
      if (record.journal_entry_id) {
        const [lines] = await db.query(
          `SELECT l.credit_amount AS amount, l.description, a.account_code, a.account_name
           FROM journal_entry_lines l LEFT JOIN chart_of_accounts a ON a.id = l.account_id
           WHERE l.journal_entry_id = ? AND l.line_number > 2 AND l.credit_amount > 0
           ORDER BY l.line_number`,
          [record.journal_entry_id]
        );
        deductions = lines.map(l => ({
          name: String(l.description || '').replace(` for ${record.staff_name}`, ''),
          account: [l.account_code, l.account_name].filter(Boolean).join(' - '),
          amount: Number(l.amount),
        }));
      }
      res.json({ success: true, data: { ...record, deductions } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

module.exports = staffPayrollController;
