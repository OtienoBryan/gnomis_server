const db = require('../database/db');

// Statuses an expense can be moved between (new expenses start as 'Pending')
const STATUSES = ['Pending', 'Approved', 'Rejected'];

// GET /api/financial/staff-expenses?status=&user_id=&start_date=&end_date=
const listExpenses = async (req, res) => {
  try {
    const { status, user_id, start_date, end_date } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('e.status = ?'); params.push(status); }
    if (user_id) { where.push('e.user_id = ?'); params.push(user_id); }
    if (start_date) { where.push('DATE(e.created_at) >= ?'); params.push(start_date); }
    if (end_date) { where.push('DATE(e.created_at) <= ?'); params.push(end_date); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT e.id, e.user_id, COALESCE(sr.name, st.name, CONCAT('User ', e.user_id)) AS staff_name,
              e.amount, e.reference, e.payment_method, e.description, e.status, e.created_at
       FROM expenses e
       LEFT JOIN SalesRep sr ON sr.id = e.user_id
       LEFT JOIN staff st ON st.id = e.user_id
       ${whereSql}
       ORDER BY e.created_at DESC, e.id DESC`,
      params
    );
    res.json({ success: true, data: rows, statuses: STATUSES });
  } catch (error) {
    console.error('Error fetching staff expenses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch staff expenses' });
  }
};

// PATCH /api/financial/staff-expenses/:id/status  { status }
const updateExpenseStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = (req.body?.status ?? '').toString().trim();
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid expense id' });
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    const [result] = await db.query('UPDATE expenses SET status = ? WHERE id = ?', [status, id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Expense not found' });
    res.json({ success: true, data: { id, status } });
  } catch (error) {
    console.error('Error updating staff expense status:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
};

module.exports = { listExpenses, updateExpenseStatus, STATUSES };
