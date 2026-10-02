const db = require('../database/db');

exports.getAllShortExpiryReports = async (req, res) => {
  try {
    console.log('Short expiry reports route hit!');
    const { startDate, endDate, currentDate, page = 1, limit = 10, outlet, salesRep, productName, search } = req.query;
    const isViewAll = parseInt(limit) === -1;
    const offset = isViewAll ? 0 : (parseInt(page) - 1) * parseInt(limit);
    
    let sql = `
      SELECT se.id, se.productId, se.product_name, se.quantity, se.batch_number, 
             se.expiry_date, se.createdAt, se.rep_id, se.appoint_id, se.outlet_id,
             se.comment,
             c.name AS outletName,
             r.name AS regionName,
             oc.name AS outletTypeName,
             oa.name AS outletAccountName,
             sr.name AS salesRepName,
             s.sku AS productSku
      FROM short_expiry se
      LEFT JOIN Clients c ON se.outlet_id = c.id
      LEFT JOIN Regions r ON c.region_id = r.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
      LEFT JOIN SalesRep sr ON se.rep_id = sr.id
      LEFT JOIN products p ON se.productId = p.id
      LEFT JOIN skus s ON p.sku_id = s.id
    `;
    let countSql = `
      SELECT COUNT(*) as total
      FROM short_expiry se
      LEFT JOIN Clients c ON se.outlet_id = c.id
      LEFT JOIN Regions r ON c.region_id = r.id
      LEFT JOIN SalesRep sr ON se.rep_id = sr.id
      LEFT JOIN products p ON se.productId = p.id
      LEFT JOIN skus s ON p.sku_id = s.id
    `;
    const params = [];
    const countParams = [];
    let whereConditions = [];
    
    // Default filter: Show products expiring within 30 days (including already expired within last 30 days)
    // Only apply if no explicit date filters are provided
    const hasDateFilter = currentDate || startDate || endDate;
    if (!hasDateFilter) {
      // Filter by expiry_date being within 30 days from today (past or future)
      // Handle expiry_date as date string (varchar) - try to parse it
      whereConditions.push(`(
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') IS NOT NULL AND
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      )`);
    } else {
      // Only apply createdAt filtering if explicit date filters are provided
      if (currentDate) {
        whereConditions.push(`DATE(se.createdAt) = ?`);
        params.push(currentDate);
        countParams.push(currentDate);
      } else if (startDate && endDate) {
        whereConditions.push(`DATE(se.createdAt) BETWEEN ? AND ?`);
        params.push(startDate, endDate);
        countParams.push(startDate, endDate);
      } else if (startDate) {
        whereConditions.push(`DATE(se.createdAt) >= ?`);
        params.push(startDate);
        countParams.push(startDate);
      } else if (endDate) {
        whereConditions.push(`DATE(se.createdAt) <= ?`);
        params.push(endDate);
        countParams.push(endDate);
      }
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
      countParams.push(outlet);
    }
    
    if (salesRep && salesRep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(salesRep);
      countParams.push(salesRep);
    }
    
    if (productName && productName.trim()) {
      whereConditions.push(`se.product_name LIKE ?`);
      const productTerm = `%${productName.trim()}%`;
      params.push(productTerm);
      countParams.push(productTerm);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        se.product_name LIKE ? OR 
        se.batch_number LIKE ? OR 
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Filter by leader_id if user role is leader
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'leader') {
      whereConditions.push(`sr.leader_id = ?`);
      params.push(req.user.id);
      countParams.push(req.user.id);
    }
    
    if (whereConditions.length > 0) {
      const whereClause = ` WHERE ${whereConditions.join(' AND ')}`;
      sql += whereClause;
      countSql += whereClause;
    }
    
    // Order by expiry_date ascending (soonest to expire first) when filtering by expiry
    if (!hasDateFilter) {
      sql += ` ORDER BY STR_TO_DATE(se.expiry_date, '%Y-%m-%d') ASC, se.createdAt DESC`;
    } else {
      sql += ` ORDER BY se.createdAt DESC`;
    }
    if (!isViewAll) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), offset);
    }
    
    console.log(`Fetching short expiry reports with date filter: ${startDate || endDate || currentDate || 'today'}`);
    
    const [results] = await db.query(sql, params);
    const [countResult] = await db.query(countSql, countParams);
    const total = countResult[0].total;
    
    console.log(`Query returned ${results.length} reports out of ${total} total`);
    
    res.json({ 
      success: true, 
      data: results,
      pagination: {
        page: isViewAll ? 1 : parseInt(page),
        limit: isViewAll ? total : parseInt(limit),
        total,
        totalPages: isViewAll ? 1 : Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Error fetching short expiry reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.exportShortExpiryReportsCSV = async (req, res) => {
  try {
    console.log('Short expiry reports CSV export route hit!');
    const { startDate, endDate, currentDate, outlet, salesRep, productName, search } = req.query;
    
    let sql = `
      SELECT se.id, se.productId, se.product_name, se.quantity, se.batch_number, 
             se.expiry_date, se.createdAt, se.rep_id, se.appoint_id, se.outlet_id,
             se.comment,
             c.name AS outletName,
             r.name AS regionName,
             oc.name AS outletTypeName,
             oa.name AS outletAccountName,
             sr.name AS salesRepName,
             s.sku AS productSku
      FROM short_expiry se
      LEFT JOIN Clients c ON se.outlet_id = c.id
      LEFT JOIN Regions r ON c.region_id = r.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
      LEFT JOIN SalesRep sr ON se.rep_id = sr.id
      LEFT JOIN products p ON se.productId = p.id
      LEFT JOIN skus s ON p.sku_id = s.id
    `;
    const params = [];
    let whereConditions = [];
    
    // Default filter: Show products expiring within 30 days (including already expired within last 30 days)
    // Only apply if no explicit date filters are provided
    const hasDateFilter = currentDate || startDate || endDate;
    if (!hasDateFilter) {
      // Filter by expiry_date being within 30 days from today (past or future)
      whereConditions.push(`(
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') IS NOT NULL AND
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND
        STR_TO_DATE(se.expiry_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      )`);
    } else {
      // Only apply createdAt filtering if explicit date filters are provided
      if (currentDate) {
        whereConditions.push(`DATE(se.createdAt) = ?`);
        params.push(currentDate);
      } else if (startDate && endDate) {
        whereConditions.push(`DATE(se.createdAt) BETWEEN ? AND ?`);
        params.push(startDate, endDate);
      } else if (startDate) {
        whereConditions.push(`DATE(se.createdAt) >= ?`);
        params.push(startDate);
      } else if (endDate) {
        whereConditions.push(`DATE(se.createdAt) <= ?`);
        params.push(endDate);
      }
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
    }
    
    if (salesRep && salesRep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(salesRep);
    }
    
    if (productName && productName.trim()) {
      whereConditions.push(`se.product_name LIKE ?`);
      params.push(`%${productName.trim()}%`);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        se.product_name LIKE ? OR 
        se.batch_number LIKE ? OR 
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Filter by leader_id if user role is leader
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'leader') {
      whereConditions.push(`sr.leader_id = ?`);
      params.push(req.user.id);
    }
    
    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    // Order by expiry_date ascending (soonest to expire first) when filtering by expiry
    if (!hasDateFilter) {
      sql += ` ORDER BY STR_TO_DATE(se.expiry_date, '%Y-%m-%d') ASC, se.createdAt DESC`;
    } else {
      sql += ` ORDER BY se.createdAt DESC`;
    }
    
    const [results] = await db.query(sql, params);
    
    // Convert to CSV
    const headers = ['ID', 'Product ID', 'Product Name', 'Quantity', 'Batch Number', 'Expiry Date', 'Created At', 'Outlet', 'Region', 'Outlet Type', 'Outlet Account', 'Sales Rep'];
    const csvRows = [headers.join(',')];
    
    results.forEach(row => {
      const values = [
        row.id || '',
        row.productId || '',
        `"${(row.product_name || '').replace(/"/g, '""')}"`,
        row.quantity || '',
        `"${(row.batch_number || '').replace(/"/g, '""')}"`,
        `"${(row.expiry_date || '').replace(/"/g, '""')}"`,
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
        `"${(row.outletName || '').replace(/"/g, '""')}"`,
        `"${(row.regionName || '').replace(/"/g, '""')}"`,
        `"${(row.outletTypeName || '').replace(/"/g, '""')}"`,
        `"${(row.outletAccountName || '').replace(/"/g, '""')}"`,
        `"${(row.salesRepName || '').replace(/"/g, '""')}"`
      ];
      csvRows.push(values.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=short-expiry-reports-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting short expiry reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getShortExpiryOutlets = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT c.id, c.name
      FROM short_expiry se
      INNER JOIN Clients c ON se.outlet_id = c.id
      ORDER BY c.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching outlets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getShortExpirySalesReps = async (req, res) => {
  try {
    let sql = `
      SELECT DISTINCT sr.id, sr.name
      FROM short_expiry se
      INNER JOIN SalesRep sr ON se.rep_id = sr.id
    `;
    
    const params = [];
    let whereConditions = [];
    
    // Filter by leader_id if user role is leader
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'leader') {
      whereConditions.push(`sr.leader_id = ?`);
      params.push(req.user.id);
    }
    
    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    sql += ` ORDER BY sr.name ASC`;
    
    const [results] = await db.query(sql, params);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching sales reps:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
