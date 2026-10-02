const db = require('../database/db');

const returnsController = {
  // Get all returns
  getAllReturns: async (req, res) => {
    try {
      console.log('Fetching returns with filters:', req.query);
      console.log('Current user:', req.user);
      
      const { client_id, region_id, outlet_account_id, start_date, end_date } = req.query;
      const whereClauses = [];
      const queryParams = [];
      
      // Filter by team leader if user is a team leader
      if (req.user && req.user.role === 'leader') {
        whereClauses.push('sr.leader_id = ?');
        queryParams.push(req.user.id);
        console.log('Filtering by team leader ID:', req.user.id);
      }
      
      // Add client_id filter if provided
      if (client_id) {
        whereClauses.push('r.client_id = ?');
        queryParams.push(client_id);
      }
      
      // Add region_id filter if provided
      if (region_id) {
        whereClauses.push('c.region_id = ?');
        queryParams.push(region_id);
      }
      
      // Add outlet_account filter if provided
      if (outlet_account_id) {
        whereClauses.push('c.outlet_account = ?');
        queryParams.push(outlet_account_id);
      }
      
      // Add date filters
      if (start_date) {
        whereClauses.push('DATE(r.order_date) >= ?');
        queryParams.push(start_date);
      }
      
      if (end_date) {
        whereClauses.push('DATE(r.order_date) <= ?');
        queryParams.push(end_date);
      }
      
      const whereClause = whereClauses.length > 0 
        ? `WHERE ${whereClauses.join(' AND ')}`
        : '';
      
      const [rows] = await db.query(`
        SELECT 
          r.id,
          r.so_number,
          r.client_id,
          r.order_date,
          r.salesrep,
          c.name as client_name,
          c.email as client_email,
          c.contact as client_contact,
          reg.name as region_name,
          oa.name as outlet_account_name,
          sr.name as salesrep_name
        FROM returns r
        LEFT JOIN Clients c ON r.client_id = c.id
        LEFT JOIN Regions reg ON c.region_id = reg.id
        LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
        LEFT JOIN SalesRep sr ON r.salesrep = sr.id
        ${whereClause}
        ORDER BY r.order_date DESC, r.id DESC
      `, queryParams);
      
      console.log(`Fetched ${rows.length} returns`);
      
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching returns:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch returns',
        details: error.message 
      });
    }
  },

  // Get return by ID
  getReturnById: async (req, res) => {
    try {
      const { id } = req.params;
      
      const [rows] = await db.query(`
        SELECT 
          r.id,
          r.so_number,
          r.client_id,
          r.order_date,
          r.salesrep,
          c.name as client_name,
          c.email as client_email,
          c.contact as client_contact,
          reg.name as region_name,
          oa.name as outlet_account_name,
          sr.name as salesrep_name
        FROM returns r
        LEFT JOIN Clients c ON r.client_id = c.id
        LEFT JOIN Regions reg ON c.region_id = reg.id
        LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
        LEFT JOIN SalesRep sr ON r.salesrep = sr.id
        WHERE r.id = ?
      `, [id]);
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Return not found'
        });
      }
      
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error fetching return:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch return',
        details: error.message 
      });
    }
  },

  // Get return items by return ID
  getReturnItems: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify return exists
      const [returnRows] = await db.query(`
        SELECT id FROM returns WHERE id = ?
      `, [id]);
      
      if (returnRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Return not found'
        });
      }
      
      // Get return items where sales_order_id matches the return id
      // Note: sales_order_id in return_items table refers to the return id
      const [items] = await db.query(`
        SELECT 
          ri.id,
          ri.sales_order_id,
          ri.product_id,
          ri.product_name,
          ri.quantity,
          COALESCE(ri.return_reason, ri.return_reason, '') as return_reason,
          p.product_code,
          p.unit_of_measure
        FROM return_items ri
        LEFT JOIN products p ON ri.product_id = p.id
        WHERE ri.sales_order_id = ?
        ORDER BY ri.id ASC
      `, [id]);
      
      console.log('Return items fetched:', items.length, 'items');
      if (items.length > 0) {
        console.log('Sample item:', JSON.stringify(items[0], null, 2));
      }
      
      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Error fetching return items:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch return items',
        details: error.message 
      });
    }
  }
};

module.exports = returnsController;
