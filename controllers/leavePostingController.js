const db = require('../database/db');
const { storeUploadedFile } = require('./documentController');

/**
 * Posting employee leave from the Employee Leaves page, with a live leave balance check.
 *
 * Days are counted the same way as the rest of the leave pages: calendar days, start and end
 * inclusive. A balance is the leave type's yearly default_days (annual leave also carries over
 * the unused days of the previous year, as on the Leave Report) less approved and pending leave
 * taken this year. Leave beyond the balance is posted as a separate record flagged is_unpaid,
 * and leave types named "unpaid" are always unpaid. Staff payroll does not pay is_unpaid leave.
 */

let columnReady = null;
const ensureColumns = () => {
  if (!columnReady) {
    columnReady = db.query('ALTER TABLE leave_requests ADD COLUMN is_unpaid TINYINT(1) NOT NULL DEFAULT 0')
      .catch((e) => {
        if (e.code !== 'ER_DUP_FIELDNAME') { columnReady = null; throw e; }
      });
  }
  return columnReady;
};

const DAY = 24 * 60 * 60 * 1000;
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const toDate = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const daysBetween = (start, end) => Math.round((toDate(end) - toDate(start)) / DAY) + 1;
const round1 = (n) => Math.round(n * 10) / 10;
const isUnpaidType = (t) => /unpaid/i.test(t?.name || '');
const isAnnualType = (t) => /annual/i.test(t?.name || '');

// Approved (1) and pending (0) paid leave of one type taken in a year, in days
const takenInYear = async (employeeId, leaveTypeId, year) => {
  const [rows] = await db.query(
    `SELECT start_date, end_date, is_half_day, CAST(status AS UNSIGNED) AS status
     FROM leave_requests
     WHERE employee_id = ? AND leave_type_id = ? AND COALESCE(is_unpaid, 0) = 0
       AND CAST(status AS UNSIGNED) IN (0, 1)
       AND start_date BETWEEN ? AND ?`,
    [employeeId, leaveTypeId, `${year}-01-01`, `${year}-12-31`]
  );
  let approved = 0;
  let pending = 0;
  rows.forEach((r) => {
    const days = r.is_half_day ? 0.5 : daysBetween(r.start_date, r.end_date);
    if (Number(r.status) === 1) approved += days; else pending += days;
  });
  return { approved, pending };
};

const computeBalance = async (employeeId, type, year) => {
  if (isUnpaidType(type)) {
    return { unpaid_type: true, entitlement: 0, carried_over: 0, taken: 0, pending: 0, available: 0 };
  }
  const entitlement = Number(type.default_days || 0);
  const { approved, pending } = await takenInYear(employeeId, type.id, year);
  let carried = 0;
  if (isAnnualType(type)) {
    // Same as the Leave Report: previous year's unused entitlement carries over
    const prev = await takenInYear(employeeId, type.id, year - 1);
    carried = entitlement - prev.approved;
  }
  return {
    unpaid_type: false,
    entitlement,
    carried_over: round1(carried),
    taken: round1(approved),
    pending: round1(pending),
    available: round1(entitlement + carried - approved - pending),
  };
};

const getType = async (id) => {
  const [[type]] = await db.query('SELECT id, name, default_days, is_active FROM leave_types WHERE id = ?', [id]);
  return type || null;
};

// How a request splits into paid and unpaid days given the available balance
const splitRequest = (start, end, available, unpaidType) => {
  const days = daysBetween(start, end);
  if (unpaidType) return { days, paid_days: 0, unpaid_days: days };
  const paid = Math.max(0, Math.min(days, Math.floor(available)));
  return { days, paid_days: paid, unpaid_days: days - paid };
};

const leavePostingController = {
  // GET /api/leave-requests/leave-types  (active types, for the posting form)
  getLeaveTypes: async (req, res) => {
    try {
      const [rows] = await db.query('SELECT id, name, description, default_days FROM leave_types WHERE is_active = 1 ORDER BY name');
      res.json(rows.map((t) => ({ ...t, is_unpaid: isUnpaidType(t) })));
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch leave types', error: error.message });
    }
  },

  // GET /api/leave-requests/balance?employee_id=&leave_type_id=&start_date=&end_date=
  getBalance: async (req, res) => {
    try {
      await ensureColumns();
      const { employee_id, leave_type_id, start_date, end_date } = req.query;
      if (!employee_id || !leave_type_id) return res.status(400).json({ message: 'employee_id and leave_type_id are required' });
      const type = await getType(leave_type_id);
      if (!type) return res.status(404).json({ message: 'Leave type not found' });
      const year = isoOk(start_date) ? Number(start_date.slice(0, 4)) : new Date().getFullYear();
      const balance = await computeBalance(Number(employee_id), type, year);
      const request = isoOk(start_date) && isoOk(end_date) && end_date >= start_date
        ? splitRequest(start_date, end_date, balance.available, balance.unpaid_type)
        : null;
      res.json({ year, leave_type: type.name, ...balance, request });
    } catch (error) {
      res.status(500).json({ message: 'Failed to calculate leave balance', error: error.message });
    }
  },

  // POST /api/leave-requests  (multipart: employee_id, leave_type_id, start_date, end_date, reason, approve, attachment?)
  createLeave: async (req, res) => {
    try {
      await ensureColumns();
      const { employee_id, leave_type_id, start_date, end_date, reason } = req.body || {};
      const approve = String(req.body?.approve ?? 'true') !== 'false';

      if (!employee_id) return res.status(400).json({ message: 'Select a staff member' });
      if (!leave_type_id) return res.status(400).json({ message: 'Select a leave type' });
      if (!isoOk(start_date) || !isoOk(end_date)) return res.status(400).json({ message: 'Valid start and end dates are required' });
      if (end_date < start_date) return res.status(400).json({ message: 'End date cannot be before the start date' });
      if (start_date.slice(0, 4) !== end_date.slice(0, 4)) {
        return res.status(400).json({ message: 'A leave cannot span two years. Post it as two leaves, one per year.' });
      }

      const [[staff]] = await db.query('SELECT id, name FROM staff WHERE id = ?', [employee_id]);
      if (!staff) return res.status(404).json({ message: 'Staff member not found' });
      const type = await getType(leave_type_id);
      if (!type) return res.status(404).json({ message: 'Leave type not found' });

      // Overlap with an existing approved or pending leave
      const [overlap] = await db.query(
        `SELECT id FROM leave_requests
         WHERE employee_id = ? AND CAST(status AS UNSIGNED) IN (0, 1)
           AND start_date <= ? AND end_date >= ? LIMIT 1`,
        [employee_id, end_date, start_date]
      );
      if (overlap.length) return res.status(409).json({ message: `${staff.name} already has a leave that overlaps these dates` });

      const balance = await computeBalance(Number(employee_id), type, Number(start_date.slice(0, 4)));
      const split = splitRequest(start_date, end_date, balance.available, balance.unpaid_type);

      const attachmentUrl = req.file ? await storeUploadedFile(req.file) : null;
      const status = approve ? 1 : 0;
      const approvedBy = approve ? (req.user?.id || null) : null;
      const note = (txt) => [reason ? String(reason).trim() : '', txt].filter(Boolean).join(' | ') || null;

      // Paid part first, the rest as a separate unpaid record
      const parts = [];
      if (split.paid_days > 0) {
        const paidEnd = iso(new Date(toDate(start_date).getTime() + (split.paid_days - 1) * DAY));
        parts.push({ start: start_date, end: paidEnd, unpaid: 0 });
      }
      if (split.unpaid_days > 0) {
        const unpaidStart = split.paid_days > 0
          ? iso(new Date(toDate(start_date).getTime() + split.paid_days * DAY))
          : start_date;
        parts.push({ start: unpaidStart, end: end_date, unpaid: 1 });
      }

      const conn = await db.getConnection();
      const ids = [];
      try {
        await conn.beginTransaction();
        for (const p of parts) {
          const [r] = await conn.query(
            `INSERT INTO leave_requests
               (employee_id, leave_type_id, start_date, end_date, is_half_day, reason, attachment_url, status, approved_by, is_unpaid, notes)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
            [
              employee_id, leave_type_id, p.start, p.end,
              p.unpaid && split.paid_days > 0 ? note('Unpaid: beyond leave balance') : (reason ? String(reason).trim() : null),
              attachmentUrl, status, approvedBy, p.unpaid,
              p.unpaid ? (balance.unpaid_type ? 'Unpaid leave type' : 'Unpaid: days beyond the leave balance') : null,
            ]
          );
          ids.push(r.insertId);
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      res.status(201).json({ success: true, ids, ...split, status, balance_before: balance.available });
    } catch (error) {
      console.error('Error posting leave:', error);
      res.status(500).json({ message: 'Failed to post leave', error: error.message });
    }
  },
};

module.exports = leavePostingController;
