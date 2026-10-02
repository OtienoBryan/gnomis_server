const db = require('../database/db');

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
        SELECT ph.*, s.name AS staff_name, s.role
        FROM payroll_history ph
        JOIN staff s ON ph.staff_id = s.id
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
      let staffQuery = 'SELECT id, salary FROM staff';
      let params = [];
      if (Array.isArray(staff_ids) && staff_ids.length > 0) {
        staffQuery += ' WHERE id IN (?)';
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
    const connection = await db.getConnection();
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

      // Skip reps already paid for this pay date
      const [existing] = await connection.query(
        'SELECT sales_rep_id FROM sales_rep_payroll_history WHERE pay_date = ? AND sales_rep_id IN (?)',
        [pay_date, repIds]
      );
      const alreadyPaidIds = new Set(existing.map(e => e.sales_rep_id));
      const pendingReps = reps.filter(r => !alreadyPaidIds.has(r.id));
      if (pendingReps.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Payroll already processed for all selected sales reps on this pay date.' });
      }
      const pendingRepIds = pendingReps.map(r => r.id);

      // Working days in period: every calendar day up to today (matches Sales Rep Working Days report)
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const rangeStart = new Date(period_start);
      const rangeEnd = new Date(period_end);
      let numWorkingDays = 0;
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        if (d <= today) numWorkingDays++;
      }

      // Present days: distinct login dates per rep within the period
      const [loginRows] = await connection.query(
        `SELECT userId, DATE(sessionStart) as d FROM LoginHistory
         WHERE userId IN (?) AND sessionStart BETWEEN ? AND ?
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
          if (d >= rangeStart && d <= rangeEnd && d <= today) count++;
        }
        leaveByRep[lv.userId] = (leaveByRep[lv.userId] || 0) + count;
      });

      // Active deductions to apply
      const [activeDeductions] = await connection.query('SELECT * FROM payroll_deductions WHERE is_active = 1');

      let processedCount = 0;
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
        const netPay = grossPay - totalDeductions;

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

        await connection.query(
          `INSERT INTO sales_rep_payroll_history
           (sales_rep_id, pay_date, period_start, period_end, basic_salary, working_days, days_paid, gross_pay, total_deductions, net_pay, journal_entry_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [rep.id, pay_date, period_start, period_end, basicSalary, numWorkingDays, daysPaid, grossPay, totalDeductions, netPay, journalEntryId, notes || null]
        );

        processedCount++;
        results.push({ sales_rep_id: rep.id, name: rep.name, grossPay, totalDeductions, netPay, journal_entry_id: journalEntryId });
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

  getSalesRepPayrollHistory: async (req, res) => {
    try {
      const { sales_rep_id } = req.query;
      let sql = `
        SELECT h.*, sr.name AS sales_rep_name
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