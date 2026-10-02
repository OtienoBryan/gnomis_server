const db = require('../database/db');

const STAFF_NAME = "COALESCE(sr.name, st.name, CONCAT('User ', vs.staff_id))";

// GET /api/financial/van-sales?store_id=&staff_id=&payment_method=&start_date=&end_date=
const listVanSales = async (req, res) => {
  try {
    const { store_id, staff_id, payment_method, start_date, end_date } = req.query;
    const where = [];
    const params = [];
    if (store_id) { where.push('vs.store_id = ?'); params.push(store_id); }
    if (staff_id) { where.push('vs.staff_id = ?'); params.push(staff_id); }
    if (payment_method) { where.push('vs.payment_method = ?'); params.push(payment_method); }
    if (start_date) { where.push('DATE(vs.created_at) >= ?'); params.push(start_date); }
    if (end_date) { where.push('DATE(vs.created_at) <= ?'); params.push(end_date); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT vs.id, vs.store_id, s.store_name, vs.staff_id, ${STAFF_NAME} AS staff_name,
              vs.payment_method, vs.payment_reference, vs.comment, vs.total_amount, vs.created_at,
              (SELECT COUNT(*) FROM van_sale_items i WHERE i.van_sale_id = vs.id) AS item_count,
              (SELECT COALESCE(SUM(i.quantity), 0) FROM van_sale_items i WHERE i.van_sale_id = vs.id) AS total_quantity
       FROM van_sales vs
       LEFT JOIN stores s ON s.id = vs.store_id
       LEFT JOIN SalesRep sr ON sr.id = vs.staff_id
       LEFT JOIN staff st ON st.id = vs.staff_id
       ${whereSql}
       ORDER BY vs.created_at DESC, vs.id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching van sales:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch van sales' });
  }
};

// GET /api/financial/van-sales/:id - one sale with its items
const getVanSale = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid sale id' });

    const [sales] = await db.query(
      `SELECT vs.*, s.store_name, s.store_code, ${STAFF_NAME} AS staff_name
       FROM van_sales vs
       LEFT JOIN stores s ON s.id = vs.store_id
       LEFT JOIN SalesRep sr ON sr.id = vs.staff_id
       LEFT JOIN staff st ON st.id = vs.staff_id
       WHERE vs.id = ?`,
      [id]
    );
    if (!sales.length) return res.status(404).json({ success: false, error: 'Van sale not found' });

    const [items] = await db.query(
      `SELECT i.id, i.product_id, p.product_name, i.quantity, i.unit_price, i.total_price
       FROM van_sale_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.van_sale_id = ?
       ORDER BY p.product_name ASC`,
      [id]
    );
    res.json({ success: true, data: { ...sales[0], items } });
  } catch (error) {
    console.error('Error fetching van sale:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch van sale' });
  }
};

module.exports = { listVanSales, getVanSale };
