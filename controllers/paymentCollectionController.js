const db = require('../database/db');

// Statuses a collection can be moved between (new collections start as 'Pending')
const STATUSES = ['Pending', 'Confirmed', 'Rejected'];

// GET /api/financial/payment-collections?status=&user_id=&client_id=&start_date=&end_date=
const listCollections = async (req, res) => {
  try {
    const { status, user_id, client_id, start_date, end_date } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('pc.status = ?'); params.push(status); }
    if (user_id) { where.push('pc.user_id = ?'); params.push(user_id); }
    if (client_id) { where.push('pc.client_id = ?'); params.push(client_id); }
    if (start_date) { where.push('DATE(pc.recorded_at) >= ?'); params.push(start_date); }
    if (end_date) { where.push('DATE(pc.recorded_at) <= ?'); params.push(end_date); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT pc.id, pc.client_id, c.name AS client_name,
              pc.user_id, COALESCE(sr.name, st.name, CONCAT('User ', pc.user_id)) AS staff_name,
              pc.amount, pc.payment_method, pc.comment, pc.receipt_image_url,
              pc.status, pc.recorded_at
       FROM payment_collection pc
       LEFT JOIN Clients c ON c.id = pc.client_id
       LEFT JOIN SalesRep sr ON sr.id = pc.user_id
       LEFT JOIN staff st ON st.id = pc.user_id
       ${whereSql}
       ORDER BY pc.recorded_at DESC, pc.id DESC`,
      params
    );
    res.json({ success: true, data: rows, statuses: STATUSES });
  } catch (error) {
    console.error('Error fetching payment collections:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment collections' });
  }
};

// PATCH /api/financial/payment-collections/:id/status  { status }
const updateCollectionStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = (req.body?.status ?? '').toString().trim();
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid collection id' });
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    const [result] = await db.query('UPDATE payment_collection SET status = ? WHERE id = ?', [status, id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Collection not found' });
    res.json({ success: true, data: { id, status } });
  } catch (error) {
    console.error('Error updating payment collection status:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
};

module.exports = { listCollections, updateCollectionStatus, STATUSES };
