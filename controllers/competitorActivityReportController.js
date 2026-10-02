const db = require('../database/db');

exports.getAllCompetitorActivityReports = async (req, res) => {
  try {
    console.log('Competitor activity reports route hit!');
    const { startDate, endDate, currentDate, page = 1, limit = 10, outlet, merchandiser, competingProduct, zuriProduct, search } = req.query;
    const isViewAll = parseInt(limit) === -1;
    const offset = isViewAll ? 0 : (parseInt(page) - 1) * parseInt(limit);
    
    let sql = `
      SELECT ca.id, ca.outlet, ca.outlet_id, ca.merchandiser, ca.competing_product, 
             ca.mechanism, ca.product_id, ca.zuri_product, ca.image_name, ca.date, ca.reportId,
             ca.competitor_company,
             c.name AS outletName,
             sr.name AS merchandiserName
      FROM competitior ca
      LEFT JOIN Clients c ON ca.outlet_id = c.id
      LEFT JOIN SalesRep sr ON ca.merchandiser = sr.id
    `;
    let countSql = `
      SELECT COUNT(*) as total
      FROM competitior ca
      LEFT JOIN Clients c ON ca.outlet_id = c.id
      LEFT JOIN SalesRep sr ON ca.merchandiser = sr.id
    `;
    const params = [];
    const countParams = [];
    let whereConditions = [];
    
    // Date filtering based on the date field
    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
      countParams.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
      countParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
      countParams.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
      countParams.push(endDate);
    } else {
      // Default to today if no date provided
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) = ?`);
      params.push(today);
      countParams.push(today);
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
      countParams.push(outlet);
    }
    
    if (merchandiser && merchandiser !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(merchandiser);
      countParams.push(merchandiser);
    }
    
    if (competingProduct && competingProduct.trim()) {
      whereConditions.push(`ca.competing_product LIKE ?`);
      const productTerm = `%${competingProduct.trim()}%`;
      params.push(productTerm);
      countParams.push(productTerm);
    }
    
    if (zuriProduct && zuriProduct.trim()) {
      whereConditions.push(`ca.zuri_product LIKE ?`);
      const productTerm = `%${zuriProduct.trim()}%`;
      params.push(productTerm);
      countParams.push(productTerm);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        ca.outlet LIKE ? OR 
        ca.competing_product LIKE ? OR 
        ca.zuri_product LIKE ? OR 
        ca.mechanism LIKE ? OR
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    if (whereConditions.length > 0) {
      const whereClause = ` WHERE ${whereConditions.join(' AND ')}`;
      sql += whereClause;
      countSql += whereClause;
    }
    
    sql += ` ORDER BY STR_TO_DATE(ca.date, '%Y-%m-%d') DESC, ca.id DESC`;
    if (!isViewAll) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), offset);
    }
    
    console.log(`Fetching competitor activity reports with date filter: ${startDate || endDate || currentDate || 'today'}`);
    
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
    console.error('Error fetching competitor activity reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.exportCompetitorActivityReportsCSV = async (req, res) => {
  try {
    console.log('Competitor activity reports CSV export route hit!');
    const { startDate, endDate, currentDate, outlet, merchandiser, competingProduct, zuriProduct, search } = req.query;
    
    let sql = `
      SELECT ca.id, ca.outlet, ca.outlet_id, ca.merchandiser, ca.competing_product, 
             ca.mechanism, ca.product_id, ca.zuri_product, ca.image_name, ca.date, ca.reportId,
             ca.competitor_company,
             c.name AS outletName,
             sr.name AS merchandiserName
      FROM competitior ca
      LEFT JOIN Clients c ON ca.outlet_id = c.id
      LEFT JOIN SalesRep sr ON ca.merchandiser = sr.id
    `;
    const params = [];
    let whereConditions = [];
    
    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
    } else {
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(ca.date, '%Y-%m-%d')) = ?`);
      params.push(today);
    }
    
    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
    }
    
    if (merchandiser && merchandiser !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(merchandiser);
    }
    
    if (competingProduct && competingProduct.trim()) {
      whereConditions.push(`ca.competing_product LIKE ?`);
      params.push(`%${competingProduct.trim()}%`);
    }
    
    if (zuriProduct && zuriProduct.trim()) {
      whereConditions.push(`ca.zuri_product LIKE ?`);
      params.push(`%${zuriProduct.trim()}%`);
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        ca.outlet LIKE ? OR 
        ca.competing_product LIKE ? OR 
        ca.zuri_product LIKE ? OR 
        ca.mechanism LIKE ? OR
        c.name LIKE ? OR 
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    sql += ` ORDER BY STR_TO_DATE(ca.date, '%Y-%m-%d') DESC, ca.id DESC`;
    
    const [results] = await db.query(sql, params);
    
    // Convert to CSV - matching table column order
    const headers = ['Outlet', 'Merchandiser', 'Competitor Name', 'Competing Product', 'Mechanism', 'NKCC Product', 'Date', 'ID', 'Report ID'];
    const csvRows = [headers.join(',')];
    
    results.forEach(row => {
      const values = [
        `"${(row.outletName || row.outlet || '').replace(/"/g, '""')}"`,
        `"${(row.merchandiserName || '').replace(/"/g, '""')}"`,
        `"${(row.competitor_company || '').replace(/"/g, '""')}"`,
        `"${(row.competing_product || '').replace(/"/g, '""')}"`,
        `"${(row.mechanism || '').replace(/"/g, '""')}"`,
        `"${(row.zuri_product || '').replace(/"/g, '""')}"`,
        row.date || '',
        row.id || '',
        row.reportId || ''
      ];
      csvRows.push(values.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=competitor-activity-reports-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting competitor activity reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getCompetitorActivityOutlets = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT c.id, c.name
      FROM competitior ca
      INNER JOIN Clients c ON ca.outlet_id = c.id
      ORDER BY c.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching outlets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getCompetitorActivityMerchandisers = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT sr.id, sr.name
      FROM competitior ca
      INNER JOIN SalesRep sr ON ca.merchandiser = sr.id
      ORDER BY sr.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching merchandisers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
