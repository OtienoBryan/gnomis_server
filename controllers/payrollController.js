const db = require('../database/db');
const { ensurePayrollSchema } = require('../services/payrollSchema');

const payrollController = {
  // Get available payment accounts (cash and bank accounts)
  getPaymentAccounts: async (req, res) => {
    try {
      const [accounts] = await db.query(`
        SELECT id, account_code, account_name, account_type
        FROM chart_of_accounts 
        WHERE account_type = 9 
        AND is_active = true
        ORDER BY account_code
      `);
      res.json({ success: true, data: accounts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // List payroll history (all or by staff)
  getPayrollHistory: async (req, res) => {
    try {
      const { staff_id } = req.query;
      let sql = `
        SELECT ph.*, s.name AS staff_name, 'Sales Rep' AS role
        FROM payroll_history ph
        JOIN SalesRep s ON ph.staff_id = s.id
      `;
      const params = [];
      if (staff_id) {
        sql += ' WHERE ph.staff_id = ?';
        params.push(staff_id);
      }
      sql += ' ORDER BY ph.pay_date DESC, ph.id DESC';
      const [rows] = await db.query(sql, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Add a payroll record
  addPayrollRecord: async (req, res) => {
    try {
      const { staff_id, pay_date, amount, notes } = req.body;
      if (!staff_id || !pay_date || !amount) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      await db.query(
        'INSERT INTO payroll_history (staff_id, pay_date, amount, notes) VALUES (?, ?, ?, ?)',
        [staff_id, pay_date, amount, notes || null]
      );
      res.json({ success: true, message: 'Payroll record added' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // ---- Payroll Deductions management (e.g. PAYE, NSSF, NHIF) ----
  // Each deduction links to a liability account in chart_of_accounts (account_type = 10)

  getAllDeductions: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT pd.*, coa.account_code, coa.account_name
        FROM payroll_deductions pd
        JOIN chart_of_accounts coa ON pd.account_id = coa.id
        ORDER BY pd.name
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Liability accounts (account_type = 10) available for linking a deduction
  getDeductionAccounts: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT id, account_code, account_name
        FROM chart_of_accounts
        WHERE account_type = 10 AND is_active = 1
        ORDER BY account_code
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  createDeduction: async (req, res) => {
    try {
      const { name, code, calculation_type, rate, amount, cap_amount, account_id, description, is_active } = req.body;
      if (!name || !calculation_type || !account_id) {
        return res.status(400).json({ success: false, error: 'name, calculation_type and account_id are required' });
      }
      if (!['percentage', 'fixed'].includes(calculation_type)) {
        return res.status(400).json({ success: false, error: "calculation_type must be 'percentage' or 'fixed'" });
      }

      const [accountRows] = await db.query(
        'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 10 AND is_active = 1',
        [account_id]
      );
      if (accountRows.length === 0) {
        return res.status(400).json({ success: false, error: 'account_id must reference an active liability account (account_type = 10)' });
      }

      const [result] = await db.query(
        `INSERT INTO payroll_deductions (name, code, calculation_type, rate, amount, cap_amount, account_id, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          code || null,
          calculation_type,
          calculation_type === 'percentage' ? (rate || 0) : null,
          calculation_type === 'fixed' ? (amount || 0) : null,
          cap_amount || null,
          account_id,
          description || null,
          is_active === undefined ? true : !!is_active
        ]
      );
      res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Deduction created' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  updateDeduction: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, calculation_type, rate, amount, cap_amount, account_id, description, is_active } = req.body;

      if (calculation_type && !['percentage', 'fixed'].includes(calculation_type)) {
        return res.status(400).json({ success: false, error: "calculation_type must be 'percentage' or 'fixed'" });
      }

      if (account_id !== undefined) {
        const [accountRows] = await db.query(
          'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 10 AND is_active = 1',
          [account_id]
        );
        if (accountRows.length === 0) {
          return res.status(400).json({ success: false, error: 'account_id must reference an active liability account (account_type = 10)' });
        }
      }

      const updates = [];
      const values = [];
      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (code !== undefined) { updates.push('code = ?'); values.push(code || null); }
      if (calculation_type !== undefined) { updates.push('calculation_type = ?'); values.push(calculation_type); }
      if (rate !== undefined) { updates.push('rate = ?'); values.push(rate === '' ? null : rate); }
      if (amount !== undefined) { updates.push('amount = ?'); values.push(amount === '' ? null : amount); }
      if (cap_amount !== undefined) { updates.push('cap_amount = ?'); values.push(cap_amount === '' ? null : cap_amount); }
      if (account_id !== undefined) { updates.push('account_id = ?'); values.push(account_id); }
      if (description !== undefined) { updates.push('description = ?'); values.push(description || null); }
      if (is_active !== undefined) { updates.push('is_active = ?'); values.push(!!is_active); }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No fields provided for update' });
      }

      values.push(id);
      const [result] = await db.query(`UPDATE payroll_deductions SET ${updates.join(', ')} WHERE id = ?`, values);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Deduction not found' });
      }
      res.json({ success: true, message: 'Deduction updated' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  deleteDeduction: async (req, res) => {
    try {
      const { id } = req.params;
      const [result] = await db.query('DELETE FROM payroll_deductions WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Deduction not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Helper functions for calculating deductions (same as frontend)
  calculatePAYE: (gross) => {
    if (gross <= 24000) return 0;
    if (gross <= 32333) return (gross - 24000) * 0.25;
    return (8333 * 0.25) + (gross - 32333) * 0.3;
  },

  calculateNSSF: (gross) => {
    return Math.min(gross * 0.06, 1080);
  },

  calculateNHIF: (gross) => {
    if (gross < 6000) return 150;
    if (gross < 8000) return 300;
    if (gross < 12000) return 400;
    return 500;
  },

  // Run payroll for all or selected staff
  runPayroll: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { pay_date, staff_ids, notes, overrides, payment_account_id } = req.body;
      if (!pay_date) {
        return res.status(400).json({ success: false, error: 'pay_date is required' });
      }
      if (!payment_account_id) {
        return res.status(400).json({ success: false, error: 'payment_account_id is required' });
      }

      // Fetch staff: all or selected
      let staffQuery = 'SELECT id, basic_salary AS salary FROM SalesRep WHERE status = 1';
      let params = [];
      if (Array.isArray(staff_ids) && staff_ids.length > 0) {
        staffQuery += ' AND id IN (?)';
        params.push(staff_ids);
      }
      const [staffList] = await connection.query(staffQuery, params);

      // Prevent duplicate payroll for same staff and pay_date
      const staffIds = staffList.map(s => s.id);
      if (staffIds.length === 0) {
        return res.status(400).json({ success: false, error: 'No staff found for payroll' });
      }
      const [existing] = await connection.query(
        `SELECT staff_id FROM payroll_history WHERE pay_date = ? AND staff_id IN (?)`,
        [pay_date, staffIds]
      );
      const alreadyPaidIds = new Set(existing.map(e => e.staff_id));

      // Prepare payroll records (skip already paid)
      const payrollRecords = staffList
        .filter(staff => !alreadyPaidIds.has(staff.id))
        .map(staff => {
          let amount = staff.salary;
          if (overrides && overrides[staff.id]) {
            amount = overrides[staff.id];
          }
          return [staff.id, pay_date, amount, notes || null];
        });

      if (payrollRecords.length === 0) {
        return res.status(400).json({ success: false, error: 'Payroll already processed for all selected staff for this date.' });
      }

      // Insert payroll records
      await connection.query(
        'INSERT INTO payroll_history (staff_id, pay_date, amount, notes) VALUES ?',
        [payrollRecords]
      );

      // Create journal entries for each staff member
      for (const record of payrollRecords) {
        const [staffId, payDate, grossAmount] = record;
        
        // Calculate deductions
        const paye = payrollController.calculatePAYE(grossAmount);
        const nssf = payrollController.calculateNSSF(grossAmount);
        const nhif = payrollController.calculateNHIF(grossAmount);
        const totalDeductions = paye + nssf + nhif;
        const netPay = grossAmount - totalDeductions;

        // Create journal entry
        const [journalResult] = await connection.query(
          `INSERT INTO journal_entries (entry_number, entry_date, reference, description, total_debit, total_credit, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`,
          [
            `JE-PAYROLL-${staffId}-${Date.now()}`,
            payDate,
            `PAYROLL-${staffId}`,
            `Payroll for staff ${staffId}`,
            netPay,
            netPay,
            1
          ]
        );
        const journalEntryId = journalResult.insertId;

        // Debit Net Wages (account_id 38)
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
           VALUES (?, ?, ?, 0, ?)`,
          [journalEntryId, 38, netPay, `Net wages for staff ${staffId}`]
        );

        // Credit Payment Account (user selected account)
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
           VALUES (?, ?, 0, ?, ?)`,
          [journalEntryId, payment_account_id, netPay, `Net wages payment for staff ${staffId}`]
        );

        // Credit PAYE (account_id 37) if there's tax
        if (paye > 0) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
             VALUES (?, ?, 0, ?, ?)`,
            [journalEntryId, 37, paye, `PAYE for staff ${staffId}`]
          );
        }

        // Credit NSSF (account_id 39) if there's NSSF
        if (nssf > 0) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
             VALUES (?, ?, 0, ?, ?)`,
            [journalEntryId, 39, nssf, `NSSF for staff ${staffId}`]
          );
        }

        // Credit NHIF (account_id 40) if there's NHIF
        if (nhif > 0) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
             VALUES (?, ?, 0, ?, ?)`,
            [journalEntryId, 40, nhif, `NHIF for staff ${staffId}`]
          );
        }
      }

      await connection.commit();
      res.json({ success: true, message: 'Payroll processed', count: payrollRecords.length });
    } catch (error) {
      await connection.rollback();
      res.status(500).json({ success: false, error: error.message });
    } finally {
      connection.release();
    }
  },

  // ---- Sales Rep Payroll ----
  // Prorates each sales rep's basic_salary by attendance (present + approved leave, out of
  // total working days in the period, matching the Sales Rep Working Days report), applies
  // active payroll_deductions, and posts a balanced journal entry per rep:
  //   Debit  expense_account_id  = gross pay
  //   Credit payment_account_id  = net pay
  //   Credit each deduction's linked account_id = deduction amount
  //   Credit the "Other deductions payable" account (payroll_settings.other_deductions_account_id)
  //     = approved sales_rep_deductions dated inside the period that haven't been posted yet
  //   Credit the "Staff loans receivable" account (payroll_settings.staff_loans_account_id)
  //     = recovery of approved sales_rep_advances (oldest first, up to the pay that is left)

  calculateDeductionAmount: (deduction, grossPay) => {
    let value = deduction.calculation_type === 'percentage'
      ? grossPay * (Number(deduction.rate || 0) / 100)
      : Number(deduction.amount || 0);
    if (deduction.cap_amount != null && value > Number(deduction.cap_amount)) {
      value = Number(deduction.cap_amount);
    }
    return value;
  },

  runSalesRepPayroll: async (req, res) => {
    let connection;
    try {
      await ensurePayrollSchema();
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const {
        pay_date, period_start, period_end,
        sales_rep_ids, payment_account_id, expense_account_id, notes
      } = req.body;

      if (!pay_date || !period_start || !period_end) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'pay_date, period_start and period_end are required' });
      }
      if (!payment_account_id) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'payment_account_id is required' });
      }
      if (!expense_account_id) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'expense_account_id is required' });
      }

      const [paymentAccountRows] = await connection.query(
        'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 9 AND is_active = 1',
        [payment_account_id]
      );
      if (paymentAccountRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'payment_account_id must reference an active cash/bank account (account_type = 9)' });
      }
      const [expenseAccountRows] = await connection.query(
        'SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 16 AND is_active = 1',
        [expense_account_id]
      );
      if (expenseAccountRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'expense_account_id must reference an active expense account (account_type = 16)' });
      }

      // Fetch target sales reps
      let repsQuery = 'SELECT id, name, basic_salary FROM SalesRep';
      const repsParams = [];
      if (Array.isArray(sales_rep_ids) && sales_rep_ids.length > 0) {
        repsQuery += ' WHERE id IN (?)';
        repsParams.push(sales_rep_ids);
      } else {
        repsQuery += ' WHERE status = 1';
      }
      const [reps] = await connection.query(repsQuery, repsParams);
      if (reps.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'No sales reps found for payroll' });
      }
      const repIds = reps.map(r => r.id);

      // Skip reps who already have a payroll run covering any part of this period (e.g. the same month),
      // whatever pay date it was posted with, or who were already paid on this pay date.
      const [existing] = await connection.query(
        `SELECT sales_rep_id FROM sales_rep_payroll_history
         WHERE sales_rep_id IN (?)
         AND ((period_start <= ? AND period_end >= ?) OR pay_date = ?)
         FOR UPDATE`,
        [repIds, period_end, period_start, pay_date]
      );
      const alreadyPaidIds = new Set(existing.map(e => e.sales_rep_id));
      const pendingReps = reps.filter(r => !alreadyPaidIds.has(r.id));
      if (pendingReps.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: 'Payroll has already been run for all selected sales reps for this period. A sales rep can only be paid once per period.',
        });
      }
      const pendingRepIds = pendingReps.map(r => r.id);

      // Working days in period: every calendar day up to today, excluding Sundays
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const rangeStart = new Date(period_start);
      const rangeEnd = new Date(period_end);
      let numWorkingDays = 0;
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        if (d <= today && d.getDay() !== 0) numWorkingDays++;
      }

      // Present days: distinct login dates per rep within the period
      const [loginRows] = await connection.query(
        `SELECT userId, DATE(sessionStart) as d FROM LoginHistory
         WHERE userId IN (?) AND sessionStart BETWEEN ? AND ?
         AND DAYOFWEEK(sessionStart) <> 1
         GROUP BY userId, DATE(sessionStart)`,
        [pendingRepIds, `${period_start} 00:00:00`, `${period_end} 23:59:59`]
      );
      const presentByRep = {};
      loginRows.forEach(r => {
        if (!presentByRep[r.userId]) presentByRep[r.userId] = new Set();
        presentByRep[r.userId].add(String(r.d));
      });

      // Approved leave days overlapping the period, per rep
      const [leaveRows] = await connection.query(
        `SELECT employee_id as userId, start_date, end_date FROM leave_requests
         WHERE employee_id IN (?) AND CAST(status AS UNSIGNED) = 1
         AND start_date <= ? AND end_date >= ?`,
        [pendingRepIds, period_end, period_start]
      );
      const leaveByRep = {};
      leaveRows.forEach(lv => {
        const leaveStart = new Date(lv.start_date) < rangeStart ? rangeStart : new Date(lv.start_date);
        const leaveEnd = new Date(lv.end_date) > rangeEnd ? rangeEnd : new Date(lv.end_date);
        let count = 0;
        for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
          if (d >= rangeStart && d <= rangeEnd && d <= today && d.getDay() !== 0) count++;
        }
        leaveByRep[lv.userId] = (leaveByRep[lv.userId] || 0) + count;
      });

      // Active deductions to apply
      const [activeDeductions] = await connection.query('SELECT * FROM payroll_deductions WHERE is_active = 1');

      // Approved, not-yet-posted extra deductions inside the period, oldest first
      const [extraRows] = await connection.query(
        `SELECT id, sales_rep_id, reference, amount FROM sales_rep_deductions
         WHERE status = 'approved' AND journal_entry_id IS NULL
         AND deduction_date BETWEEN ? AND ? AND sales_rep_id IN (?)
         ORDER BY deduction_date, id`,
        [period_start, period_end, pendingRepIds]
      );
      const extraByRep = {};
      extraRows.forEach(r => { (extraByRep[r.sales_rep_id] = extraByRep[r.sales_rep_id] || []).push(r); });

      let extraAccountId = null;
      if (extraRows.length > 0) {
        const [[setting]] = await connection.query(
          "SELECT setting_value FROM payroll_settings WHERE setting_key = 'other_deductions_account_id'"
        );
        extraAccountId = setting?.setting_value ? Number(setting.setting_value) : null;
        const [extraAccountRows] = extraAccountId
          ? await connection.query('SELECT id FROM chart_of_accounts WHERE id = ? AND account_type = 10 AND is_active = 1', [extraAccountId])
          : [[]];
        if (extraAccountRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: "Approved sales rep deductions are waiting to be posted. Set 'Other deductions payable' (Staff Deductions Payable) on Payroll Account Links first.",
          });
        }
      }

      // Approved salary advances (dated on or before the period end) that still have a balance to recover
      const [advanceRows] = await connection.query(
        `SELECT id, sales_rep_id, reference, amount, recovered_amount FROM sales_rep_advances
         WHERE status = 'approved' AND amount > recovered_amount
         AND advance_date <= ? AND sales_rep_id IN (?)
         ORDER BY advance_date, id
         FOR UPDATE`,
        [period_end, pendingRepIds]
      );
      const advanceByRep = {};
      advanceRows.forEach(r => { (advanceByRep[r.sales_rep_id] = advanceByRep[r.sales_rep_id] || []).push(r); });

      let advanceAccountId = null;
      if (advanceRows.length > 0) {
        const [[setting]] = await connection.query(
          "SELECT setting_value FROM payroll_settings WHERE setting_key = 'staff_loans_account_id'"
        );
        advanceAccountId = setting?.setting_value ? Number(setting.setting_value) : null;
        const [advanceAccountRows] = advanceAccountId
          ? await connection.query('SELECT id FROM chart_of_accounts WHERE id = ? AND is_active = 1', [advanceAccountId])
          : [[]];
        if (advanceAccountRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: "Approved salary advances are waiting to be recovered. Set 'Staff loans receivable' (the staff advances account) on Payroll Account Links first.",
          });
        }
      }

      let processedCount = 0;
      let postedExtraTotal = 0;
      let recoveredAdvanceTotal = 0;
      const results = [];

      for (const rep of pendingReps) {
        const basicSalary = rep.basic_salary != null ? Number(rep.basic_salary) : 0;
        if (basicSalary <= 0) continue; // nothing to pay

        const present = (presentByRep[rep.id] || new Set()).size;
        const leave = leaveByRep[rep.id] || 0;
        const daysPaid = present + leave;
        const grossPay = numWorkingDays > 0 ? basicSalary * (daysPaid / numWorkingDays) : basicSalary;
        if (grossPay <= 0) continue;

        const deductionLines = activeDeductions
          .map(d => ({ deduction: d, amount: payrollController.calculateDeductionAmount(d, grossPay) }))
          .filter(l => l.amount > 0);

        let totalDeductions = deductionLines.reduce((sum, l) => sum + l.amount, 0);
        if (totalDeductions > grossPay) totalDeductions = grossPay; // deductions can't exceed gross pay

        // Extra deductions: take whole entries, oldest first, while they still fit in the remaining pay.
        // Entries that don't fit stay unposted so they can go in a later run.
        let extraRemaining = grossPay - totalDeductions;
        const appliedExtra = [];
        for (const e of extraByRep[rep.id] || []) {
          const amt = Number(e.amount);
          if (amt > 0 && amt <= extraRemaining + 0.005) {
            appliedExtra.push(e);
            extraRemaining -= amt;
          }
        }
        const extraTotal = appliedExtra.reduce((s, e) => s + Number(e.amount), 0);

        // Salary advances: recover oldest first, up to whatever pay is left. A partly recovered
        // advance keeps its balance for the next run.
        let advanceBudget = extraRemaining;
        const recoveries = [];
        for (const a of advanceByRep[rep.id] || []) {
          if (advanceBudget < 0.01) break;
          const balance = Math.round((Number(a.amount) - Number(a.recovered_amount)) * 100) / 100;
          const take = Math.floor(Math.min(balance, advanceBudget) * 100) / 100;
          if (take <= 0) continue;
          recoveries.push({ advance: a, amount: take });
          advanceBudget -= take;
        }
        const advanceTotal = recoveries.reduce((s, r) => s + r.amount, 0);
        const netPay = grossPay - totalDeductions - extraTotal - advanceTotal;

        const [journalResult] = await connection.query(
          `INSERT INTO journal_entries (entry_number, entry_date, reference, description, total_debit, total_credit, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`,
          [
            `JE-SREP-PAYROLL-${rep.id}-${Date.now()}`,
            pay_date,
            `SALESREP-PAYROLL-${rep.id}`,
            `Sales rep payroll for ${rep.name} (${period_start} to ${period_end})`,
            grossPay,
            grossPay,
            req.user?.id || 1
          ]
        );
        const journalEntryId = journalResult.insertId;

        let lineNumber = 1;
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
           VALUES (?, ?, ?, 0, ?, ?)`,
          [journalEntryId, expense_account_id, grossPay, `Gross payroll for ${rep.name}`, lineNumber++]
        );
        await connection.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
           VALUES (?, ?, 0, ?, ?, ?)`,
          [journalEntryId, payment_account_id, netPay, `Net pay for ${rep.name}`, lineNumber++]
        );
        for (const line of deductionLines) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
             VALUES (?, ?, 0, ?, ?, ?)`,
            [journalEntryId, line.deduction.account_id, line.amount, `${line.deduction.name} for ${rep.name}`, lineNumber++]
          );
        }
        // One credit line per approved extra deduction, to Staff Deductions Payable
        for (const e of appliedExtra) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
             VALUES (?, ?, 0, ?, ?, ?)`,
            [journalEntryId, extraAccountId, Number(e.amount), `Staff deduction for ${rep.name}: ${e.reference}`, lineNumber++]
          );
        }
        if (appliedExtra.length > 0) {
          await connection.query(
            'UPDATE sales_rep_deductions SET journal_entry_id = ? WHERE id IN (?)',
            [journalEntryId, appliedExtra.map(e => e.id)]
          );
          postedExtraTotal += extraTotal;
        }
        // One credit line per advance recovered, to the staff advances account
        for (const r of recoveries) {
          await connection.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
             VALUES (?, ?, 0, ?, ?, ?)`,
            [journalEntryId, advanceAccountId, r.amount, `Salary advance recovery for ${rep.name}: ${r.advance.reference}`, lineNumber++]
          );
          await connection.query(
            'UPDATE sales_rep_advances SET recovered_amount = recovered_amount + ? WHERE id = ?',
            [r.amount, r.advance.id]
          );
          await connection.query(
            'INSERT INTO sales_rep_advance_recoveries (advance_id, sales_rep_id, journal_entry_id, amount) VALUES (?,?,?,?)',
            [r.advance.id, rep.id, journalEntryId, r.amount]
          );
        }
        recoveredAdvanceTotal += advanceTotal;

        await connection.query(
          `INSERT INTO sales_rep_payroll_history
           (sales_rep_id, pay_date, period_start, period_end, basic_salary, working_days, days_paid, gross_pay, total_deductions, net_pay, journal_entry_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [rep.id, pay_date, period_start, period_end, basicSalary, numWorkingDays, daysPaid, grossPay, totalDeductions + extraTotal + advanceTotal, netPay, journalEntryId, notes || null]
        );

        processedCount++;
        results.push({
          sales_rep_id: rep.id, name: rep.name, grossPay, totalDeductions, extraDeductions: extraTotal, advanceRecovery: advanceTotal,
          unpostedExtraDeductions: (extraByRep[rep.id] || []).length - appliedExtra.length,
          netPay, journal_entry_id: journalEntryId,
        });
      }

      if (processedCount === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'No sales reps had a positive salary/gross pay to process.' });
      }

      await connection.commit();
      res.json({
        success: true,
        message: 'Sales rep payroll processed',
        count: processedCount,
        extra_deductions_posted: postedExtraTotal,
        advances_recovered: recoveredAdvanceTotal,
        skipped: reps.length - pendingReps.length,
        results,
      });
    } catch (error) {
      await connection.rollback();
      res.status(500).json({ success: false, error: error.message });
    } finally {
      connection.release();
    }
  },

  // One history record with its deduction breakdown, for the payslip page
  getSalesRepPayslip: async (req, res) => {
    try {
      await ensurePayrollSchema();
      const [[record]] = await db.query(
        `SELECT h.*, sr.name AS sales_rep_name, sr.role AS sales_rep_role, sr.email AS sales_rep_email,
                sr.phoneNumber AS sales_rep_phone
         FROM sales_rep_payroll_history h
         JOIN SalesRep sr ON h.sales_rep_id = sr.id
         WHERE h.id = ?`,
        [req.params.id]
      );
      if (!record) return res.status(404).json({ success: false, error: 'Payslip not found' });

      let deductions = [];
      let extraDeductions = [];
      let advanceRecoveries = [];
      if (record.journal_entry_id) {
        // Lines 1 and 2 are the gross expense debit and the net pay credit; the rest are deductions
        const [lines] = await db.query(
          `SELECT l.credit_amount AS amount, l.description, a.account_code, a.account_name
           FROM journal_entry_lines l
           LEFT JOIN chart_of_accounts a ON a.id = l.account_id
           WHERE l.journal_entry_id = ? AND l.line_number > 2 AND l.credit_amount > 0
           AND l.description NOT LIKE 'Staff deduction for %'
           AND l.description NOT LIKE 'Salary advance recovery for %'
           ORDER BY l.line_number`,
          [record.journal_entry_id]
        );
        deductions = lines.map(l => ({
          name: String(l.description || '').replace(` for ${record.sales_rep_name}`, ''),
          account: [l.account_code, l.account_name].filter(Boolean).join(' - '),
          amount: Number(l.amount),
        }));
        const [extras] = await db.query(
          `SELECT reference, amount, DATE_FORMAT(deduction_date, '%Y-%m-%d') AS deduction_date
           FROM sales_rep_deductions
           WHERE journal_entry_id = ? AND sales_rep_id = ?
           ORDER BY deduction_date, id`,
          [record.journal_entry_id, record.sales_rep_id]
        );
        extraDeductions = extras.map(e => ({ reference: e.reference, amount: Number(e.amount), date: e.deduction_date }));
        const [recoveries] = await db.query(
          `SELECT r.amount, a.reference, a.amount AS advance_amount, a.recovered_amount,
                  DATE_FORMAT(a.advance_date, '%Y-%m-%d') AS advance_date
           FROM sales_rep_advance_recoveries r
           JOIN sales_rep_advances a ON a.id = r.advance_id
           WHERE r.journal_entry_id = ? AND r.sales_rep_id = ?
           ORDER BY a.advance_date, r.id`,
          [record.journal_entry_id, record.sales_rep_id]
        );
        advanceRecoveries = recoveries.map(r => ({
          reference: r.reference,
          amount: Number(r.amount),
          date: r.advance_date,
          advance_amount: Number(r.advance_amount),
          // Balance still owed on this advance after the latest run (not necessarily after this one)
          balance: Math.round((Number(r.advance_amount) - Number(r.recovered_amount)) * 100) / 100,
        }));
      }

      res.json({ success: true, data: { ...record, deductions, extra_deductions: extraDeductions, advance_recoveries: advanceRecoveries } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  getSalesRepPayrollHistory: async (req, res) => {
    try {
      await ensurePayrollSchema();
      const { sales_rep_id } = req.query;
      // total_deductions includes the extra deductions and advance recoveries posted in the same journal entry
      let sql = `
        SELECT h.*, sr.name AS sales_rep_name,
          DATE_FORMAT(h.pay_date, '%Y-%m-%d') AS pay_date,
          DATE_FORMAT(h.period_start, '%Y-%m-%d') AS period_start,
          DATE_FORMAT(h.period_end, '%Y-%m-%d') AS period_end,
          COALESCE((
            SELECT SUM(d.amount) FROM sales_rep_deductions d
            WHERE d.journal_entry_id = h.journal_entry_id AND d.sales_rep_id = h.sales_rep_id
          ), 0) AS extra_deductions,
          COALESCE((
            SELECT SUM(r.amount) FROM sales_rep_advance_recoveries r
            WHERE r.journal_entry_id = h.journal_entry_id AND r.sales_rep_id = h.sales_rep_id
          ), 0) AS advance_recovery
        FROM sales_rep_payroll_history h
        JOIN SalesRep sr ON h.sales_rep_id = sr.id
      `;
      const params = [];
      if (sales_rep_id) {
        sql += ' WHERE h.sales_rep_id = ?';
        params.push(sales_rep_id);
      }
      sql += ' ORDER BY h.pay_date DESC, h.id DESC';
      const [rows] = await db.query(sql, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

module.exports = payrollController; 