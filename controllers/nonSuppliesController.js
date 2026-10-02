const db = require('../database/db');

const nonSuppliesController = {
  // Get all non supplies
  getAllNonSupplies: async (req, res) => {
    try {
      console.log('Fetching non supplies with filters:', req.query);
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
        whereClauses.push('ns.client_id = ?');
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
        whereClauses.push('DATE(ns.order_date) >= ?');
        queryParams.push(start_date);
      }
      
      if (end_date) {
        whereClauses.push('DATE(ns.order_date) <= ?');
        queryParams.push(end_date);
      }
      
      const whereClause = whereClauses.length > 0 
        ? `WHERE ${whereClauses.join(' AND ')}`
        : '';
      
      const [rows] = await db.query(`
        SELECT 
          ns.id,
          ns.so_number,
          ns.client_id,
          ns.order_date,
          ns.salesrep,
          c.name as client_name,
          c.email as client_email,
          c.contact as client_contact,
          reg.name as region_name,
          oa.name as outlet_account_name,
          sr.name as salesrep_name
        FROM non_supplies ns
        LEFT JOIN Clients c ON ns.client_id = c.id
        LEFT JOIN Regions reg ON c.region_id = reg.id
        LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
        LEFT JOIN SalesRep sr ON ns.salesrep = sr.id
        ${whereClause}
        ORDER BY ns.order_date DESC, ns.id DESC
      `, queryParams);
      
      console.log(`Fetched ${rows.length} non supplies`);
      
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching non supplies:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch non supplies',
        details: error.message 
      });
    }
  },

  // Get non supply by ID
  getNonSupplyById: async (req, res) => {
    try {
      const { id } = req.params;
      
      const [rows] = await db.query(`
        SELECT 
          ns.id,
          ns.so_number,
          ns.client_id,
          ns.order_date,
          ns.salesrep,
          c.name as client_name,
          c.email as client_email,
          c.contact as client_contact,
          reg.name as region_name,
          oa.name as outlet_account_name,
          sr.name as salesrep_name
        FROM non_supplies ns
        LEFT JOIN Clients c ON ns.client_id = c.id
        LEFT JOIN Regions reg ON c.region_id = reg.id
        LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
        LEFT JOIN SalesRep sr ON ns.salesrep = sr.id
        WHERE ns.id = ?
      `, [id]);
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Non supply not found'
        });
      }
      
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error fetching non supply:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch non supply',
        details: error.message 
      });
    }
  },

  // Get non supply items by non supply ID
  getNonSupplyItems: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify non supply exists
      const [nonSupplyRows] = await db.query(`
        SELECT id FROM non_supplies WHERE id = ?
      `, [id]);
      
      if (nonSupplyRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Non supply not found'
        });
      }
      
      // Get non supply items where sales_order_id matches the non supply id
      const [items] = await db.query(`
        SELECT 
          nsi.id,
          nsi.sales_order_id,
          nsi.product_id,
          nsi.product_name,
          nsi.quantity,
          COALESCE(nsi.non_supply_reason, nsi.non_supply_reason, '') as non_supply_reason,
          p.product_code,
          p.unit_of_measure
        FROM non_supply_items nsi
        LEFT JOIN products p ON nsi.product_id = p.id
        WHERE nsi.sales_order_id = ?
        ORDER BY nsi.id ASC
      `, [id]);
      
      console.log('Non supply items fetched:', items.length, 'items');
      if (items.length > 0) {
        console.log('Sample item:', JSON.stringify(items[0], null, 2));
      }
      
      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Error fetching non supply items:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch non supply items',
        details: error.message 
      });
    }
  },

  // Get non supply items summary (all items with outlet, product, and reason)
  getNonSupplyItemsSummary: async (req, res) => {
    try {
      console.log('Fetching non supply items summary with filters:', req.query);
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
        whereClauses.push('ns.client_id = ?');
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
        whereClauses.push('DATE(ns.order_date) >= ?');
        queryParams.push(start_date);
      }
      
      if (end_date) {
        whereClauses.push('DATE(ns.order_date) <= ?');
        queryParams.push(end_date);
      }
      
      const whereClause = whereClauses.length > 0 
        ? `WHERE ${whereClauses.join(' AND ')}`
        : '';
      
      // Get all non supply items with outlet and product details
      const [items] = await db.query(`
        SELECT 
          nsi.id,
          nsi.sales_order_id,
          nsi.product_id,
          nsi.product_name,
          nsi.quantity,
          COALESCE(nsi.non_supply_reason, '') as non_supply_reason,
          p.product_code,
          p.unit_of_measure,
          ns.so_number,
          ns.order_date,
          c.id as client_id,
          c.name as outlet_name,
          c.contact as outlet_contact,
          reg.name as region_name,
          oa.name as outlet_account_name,
          sr.name as salesrep_name
        FROM non_supply_items nsi
        INNER JOIN non_supplies ns ON nsi.sales_order_id = ns.id
        LEFT JOIN Clients c ON ns.client_id = c.id
        LEFT JOIN Regions reg ON c.region_id = reg.id
        LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
        LEFT JOIN SalesRep sr ON ns.salesrep = sr.id
        LEFT JOIN products p ON nsi.product_id = p.id
        ${whereClause}
        ORDER BY ns.order_date DESC, c.name ASC, nsi.product_name ASC
      `, queryParams);
      
      console.log(`Fetched ${items.length} non supply items for summary`);
      
      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Error fetching non supply items summary:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch non supply items summary',
        details: error.message 
      });
    }
  }
};

module.exports = nonSuppliesController;
