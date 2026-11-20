const db = require('../database/db');
const { ensurePayrollSchema } = require('../services/payrollSchema');

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const handle = (fn) => async (req, res) => {
  try {
    await ensurePayrollSchema();
    await fn(req, res);
  } catch (error) {
    console.error('Sales rep deduction error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/payroll/sales-rep-deductions?sales_rep_id=&start_date=&end_date=
const list = handle(async (req, res) => {
  const { sales_rep_id, start_date, end_date } = req.query;
  const where = [];
  const params = [];
  if (sales_rep_id) { where.push('d.sales_rep_id = ?'); params.push(sales_rep_id); }
  if (start_date) { where.push('d.deduction_date >= ?'); params.push(start_date); }
  if (end_date) { where.push('d.deduction_date <= ?'); params.push(end_date); }
  const [rows] = await db.query(
    `SELECT d.id, d.sales_rep_id, sr.name AS sales_rep_name, d.reference, d.amount, d.status,
            DATE_FORMAT(d.deduction_date, '%Y-%m-%d') AS deduction_date, d.created_at
     FROM sales_rep_deductions d
     LEFT JOIN SalesRep sr ON sr.id = d.sales_rep_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.deduction_date DESC, d.id DESC
     LIMIT 500`,
    params
  );
  res.json({ success: true, data: rows });
});

// POST /api/payroll/sales-rep-deductions
const create = handle(async (req, res) => {
  const { sales_rep_id, reference, amount, deduction_date } = req.body || {};
  const ref = String(reference || '').trim();
  const amt = Number(amount);

  if (!sales_rep_id) return fail(res, 400, 'Sales rep is required');
  if (!ref) return fail(res, 400, 'Reference is required');
  if (!Number.isFinite(amt) || amt <= 0) return fail(res, 400, 'Amount must be greater than zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deduction_date || ''))) return fail(res, 400, 'A valid date is required');

  const [[rep]] = await db.query('SELECT id FROM SalesRep WHERE id = ?', [sales_rep_id]);
  if (!rep) return fail(res, 404, 'Sales rep not found');

  const [result] = await db.query(
    'INSERT INTO sales_rep_deductions (sales_rep_id, reference, amount, deduction_date, created_by) VALUES (?,?,?,?,?)',
    [sales_rep_id, ref, amt, deduction_date, req.user?.id || null]
  );
  res.status(201).json({ success: true, data: { id: result.insertId } });
});

// PUT /api/payroll/sales-rep-deductions/:id/status  { status: 'approved' | 'rejected' }
const review = handle(async (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return fail(res, 400, 'Status must be approved or rejected');

  const [result] = await db.query(
    `UPDATE sales_rep_deductions SET status = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [status, req.user?.id || null, req.params.id]
  );
  if (!result.affectedRows) {
    const [[row]] = await db.query('SELECT status FROM sales_rep_deductions WHERE id = ?', [req.params.id]);
    if (!row) return fail(res, 404, 'Deduction not found');
    return fail(res, 409, `Deduction is already ${row.status}`);
  }
  res.json({ success: true, data: { id: Number(req.params.id), status } });
});

// DELETE /api/payroll/sales-rep-deductions/:id
const remove = handle(async (req, res) => {
  const [result] = await db.query('DELETE FROM sales_rep_deductions WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return fail(res, 404, 'Deduction not found');
  res.json({ success: true });
});

module.exports = { list, create, review, remove };
