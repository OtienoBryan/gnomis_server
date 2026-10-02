const db = require('../database/db');

exports.getAllPriceComplianceReports = async (req, res) => {
  try {
    console.log('Price compliance reports route hit!');
    const { startDate, endDate, currentDate, page = 1, limit = 10, outlet, salesRep, product, priceCorrect, promotion, search } = req.query;
    const isViewAll = parseInt(limit) === -1;
    const offset = isViewAll ? 0 : (parseInt(page) - 1) * parseInt(limit);
    
    let sql = `
      SELECT pc.id, pc.rep_id, pc.outlet_id, pc.outlet_name, pc.product_id, pc.product_name,
             pc.rrp, pc.shelf_price, pc.comment, pc.price_correct, pc.promotion, pc.date, pc.appoint_id,
             c.name AS outletName,
             sr.name AS salesRepName,
             reg.name AS regionName,
             oc.name AS outletTypeName,
             oa.name AS outletAccountName
      FROM price_compliance pc
      LEFT JOIN Clients c ON pc.outlet_id = c.id
      LEFT JOIN SalesRep sr ON pc.rep_id = sr.id
      LEFT JOIN Regions reg ON c.region_id = reg.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;
    let countSql = `
      SELECT COUNT(*) as total
      FROM price_compliance pc
      LEFT JOIN Clients c ON pc.outlet_id = c.id
      LEFT JOIN SalesRep sr ON pc.rep_id = sr.id
    `;
    const params = [];
    const countParams = [];
    let whereConditions = [];
    
    // Date filtering based on the date field
    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
      countParams.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
      countParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
      countParams.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
      countParams.push(endDate);
    } else {
      // Default to today if no date provided
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) = ?`);
      params.push(today);
      countParams.push(today);
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`(c.name = ? OR pc.outlet_name = ?)`);
      params.push(outlet, outlet);
      countParams.push(outlet, outlet);
    }
    
    if (salesRep && salesRep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(salesRep);
      countParams.push(salesRep);
    }
    
    if (product && product.trim()) {
      whereConditions.push(`pc.product_name LIKE ?`);
      const productTerm = `%${product.trim()}%`;
      params.push(productTerm);
      countParams.push(productTerm);
    }
    
    if (priceCorrect && priceCorrect !== 'all') {
      whereConditions.push(`pc.price_correct = ?`);
      params.push(priceCorrect);
      countParams.push(priceCorrect);
    }
    
    if (promotion && promotion !== 'all') {
      whereConditions.push(`pc.promotion = ?`);
      params.push(promotion);
      countParams.push(promotion);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        pc.outlet_name LIKE ? OR 
        pc.product_name LIKE ? OR 
        pc.comment LIKE ? OR
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
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
    
    sql += ` ORDER BY STR_TO_DATE(pc.date, '%Y-%m-%d') DESC, pc.id DESC`;
    if (!isViewAll) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), offset);
    }
    
    console.log(`Fetching price compliance reports with date filter: ${startDate || endDate || currentDate || 'today'}`);
    
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
    console.error('Error fetching price compliance reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.exportPriceComplianceReportsCSV = async (req, res) => {
  try {
    console.log('Price compliance reports CSV export route hit!');
    const { startDate, endDate, currentDate, outlet, salesRep, product, priceCorrect, promotion, search } = req.query;
    
    let sql = `
      SELECT pc.id, pc.rep_id, pc.outlet_id, pc.outlet_name, pc.product_id, pc.product_name,
             pc.rrp, pc.shelf_price, pc.comment, pc.price_correct, pc.promotion, pc.date, pc.appoint_id,
             c.name AS outletName,
             sr.name AS salesRepName,
             reg.name AS regionName,
             oc.name AS outletTypeName,
             oa.name AS outletAccountName
      FROM price_compliance pc
      LEFT JOIN Clients c ON pc.outlet_id = c.id
      LEFT JOIN SalesRep sr ON pc.rep_id = sr.id
      LEFT JOIN Regions reg ON c.region_id = reg.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;
    const params = [];
    let whereConditions = [];
    
    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
    } else {
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(pc.date, '%Y-%m-%d')) = ?`);
      params.push(today);
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`(c.name = ? OR pc.outlet_name = ?)`);
      params.push(outlet, outlet);
    }
    
    if (salesRep && salesRep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(salesRep);
    }
    
    if (product && product.trim()) {
      whereConditions.push(`pc.product_name LIKE ?`);
      params.push(`%${product.trim()}%`);
    }
    
    if (priceCorrect && priceCorrect !== 'all') {
      whereConditions.push(`pc.price_correct = ?`);
      params.push(priceCorrect);
    }
    
    if (promotion && promotion !== 'all') {
      whereConditions.push(`pc.promotion = ?`);
      params.push(promotion);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        pc.outlet_name LIKE ? OR 
        pc.product_name LIKE ? OR 
        pc.comment LIKE ? OR
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Filter by leader_id if user role is leader
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'leader') {
      whereConditions.push(`sr.leader_id = ?`);
      params.push(req.user.id);
    }
    
    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    sql += ` ORDER BY STR_TO_DATE(pc.date, '%Y-%m-%d') DESC, pc.id DESC`;
    
    const [results] = await db.query(sql, params);
    
    // Convert to CSV
    const headers = ['ID', 'Outlet', 'Region', 'Outlet Type', 'Outlet Account', 'Sales Rep', 'Product', 'RRP', 'Shelf Price', 'Price Correct', 'Promotion', 'Comment', 'Date'];
    const csvRows = [headers.join(',')];
    
    results.forEach(row => {
      const values = [
        row.id || '',
        `"${(row.outletName || row.outlet_name || '').replace(/"/g, '""')}"`,
        `"${(row.regionName || '').replace(/"/g, '""')}"`,
        `"${(row.outletTypeName || '').replace(/"/g, '""')}"`,
        `"${(row.outletAccountName || '').replace(/"/g, '""')}"`,
        `"${(row.salesRepName || '').replace(/"/g, '""')}"`,
        `"${(row.product_name || '').replace(/"/g, '""')}"`,
        row.rrp || '',
        row.shelf_price || '',
        `"${(row.price_correct || '').replace(/"/g, '""')}"`,
        `"${(row.promotion || '').replace(/"/g, '""')}"`,
        `"${(row.comment || '').replace(/"/g, '""')}"`,
        row.date || ''
      ];
      csvRows.push(values.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=price-compliance-reports-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting price compliance reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPriceComplianceOutlets = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT c.id, c.name
      FROM price_compliance pc
      INNER JOIN Clients c ON pc.outlet_id = c.id
      ORDER BY c.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching outlets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPriceComplianceSalesReps = async (req, res) => {
  try {
    let sql = `
      SELECT DISTINCT sr.id, sr.name
      FROM price_compliance pc
      INNER JOIN SalesRep sr ON pc.rep_id = sr.id
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
