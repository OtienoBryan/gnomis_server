const db = require('../database/db');
const { ensurePayrollSchema } = require('../services/payrollSchema');

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const handle = (fn) => async (req, res) => {
  try {
    await ensurePayrollSchema();
    await fn(req, res);
  } catch (error) {
    console.error('Sales rep advance error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/payroll/sales-rep-advances?sales_rep_id=&start_date=&end_date=&outstanding=1
//   outstanding=1 -> only approved advances that still have a balance to recover
const list = handle(async (req, res) => {
  const { sales_rep_id, start_date, end_date, outstanding } = req.query;
  const where = [];
  const params = [];
  if (sales_rep_id) { where.push('a.sales_rep_id = ?'); params.push(sales_rep_id); }
  if (start_date) { where.push('a.advance_date >= ?'); params.push(start_date); }
  if (end_date) { where.push('a.advance_date <= ?'); params.push(end_date); }
  if (outstanding) where.push("a.status = 'approved' AND a.amount > a.recovered_amount");
  const [rows] = await db.query(
    `SELECT a.id, a.sales_rep_id, sr.name AS sales_rep_name, a.reference, a.amount, a.recovered_amount, a.status,
            DATE_FORMAT(a.advance_date, '%Y-%m-%d') AS advance_date, a.created_at
     FROM sales_rep_advances a
     LEFT JOIN SalesRep sr ON sr.id = a.sales_rep_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.advance_date DESC, a.id DESC
     LIMIT 500`,
    params
  );
  res.json({ success: true, data: rows });
});

// POST /api/payroll/sales-rep-advances  (always created as pending)
const create = handle(async (req, res) => {
  const { sales_rep_id, reference, amount, advance_date } = req.body || {};
  const ref = String(reference || '').trim();
  const amt = Number(amount);

  if (!sales_rep_id) return fail(res, 400, 'Sales rep is required');
  if (!ref) return fail(res, 400, 'Reference is required');
  if (!Number.isFinite(amt) || amt <= 0) return fail(res, 400, 'Amount must be greater than zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(advance_date || ''))) return fail(res, 400, 'A valid date is required');

  const [[rep]] = await db.query('SELECT id FROM SalesRep WHERE id = ?', [sales_rep_id]);
  if (!rep) return fail(res, 404, 'Sales rep not found');

  const [result] = await db.query(
    'INSERT INTO sales_rep_advances (sales_rep_id, reference, amount, advance_date, created_by) VALUES (?,?,?,?,?)',
    [sales_rep_id, ref, amt, advance_date, req.user?.id || null]
  );
  res.status(201).json({ success: true, data: { id: result.insertId } });
});

// PUT /api/payroll/sales-rep-advances/:id/status  { status: 'approved' | 'rejected' }
const review = handle(async (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return fail(res, 400, 'Status must be approved or rejected');

  const [result] = await db.query(
    `UPDATE sales_rep_advances SET status = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [status, req.user?.id || null, req.params.id]
  );
  if (!result.affectedRows) {
    const [[row]] = await db.query('SELECT status FROM sales_rep_advances WHERE id = ?', [req.params.id]);
    if (!row) return fail(res, 404, 'Advance not found');
    return fail(res, 409, `Advance is already ${row.status}`);
  }
  res.json({ success: true, data: { id: Number(req.params.id), status } });
});

// DELETE /api/payroll/sales-rep-advances/:id  (not allowed once any of it has been recovered through payroll)
const remove = handle(async (req, res) => {
  const [[row]] = await db.query('SELECT recovered_amount FROM sales_rep_advances WHERE id = ?', [req.params.id]);
  if (!row) return fail(res, 404, 'Advance not found');
  if (Number(row.recovered_amount) > 0) return fail(res, 409, 'This advance has already been partly or fully recovered through payroll and cannot be deleted');
  await db.query('DELETE FROM sales_rep_advances WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = { list, create, review, remove };
