const db = require('../database/db');

// Get all SOS reports with filters and pagination
exports.getAllSosReports = async (req, res) => {
  try {
    console.log('SOS reports route hit!');

    const {
      startDate,
      endDate,
      currentDate,
      page = 1,
      limit = 10,
      outlet,
      rep,
      brand,
      outletAccount,
      targetStatus,
      search,
    } = req.query;

    const isViewAll = parseInt(limit) === -1;
    const offset = isViewAll ? 0 : (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let sql = `
      SELECT 
        s.id,
        s.rep_id,
        s.appoint_id,
        s.outlet_id,
        s.brand_id,
        s.brand_name,
        s.brand_facings,
        s.total_facings,
        s.sos,
        s.outlet_target,
        s.comment,
        s.date,
        c.name AS outletName,
        sr.name AS repName,
        reg.name AS regionName,
        oc.name AS outletTypeName,
        oa.name AS outletAccountName
      FROM sos_report s
      LEFT JOIN Clients c ON s.outlet_id = c.id
      LEFT JOIN SalesRep sr ON s.rep_id = sr.id
      LEFT JOIN Regions reg ON c.region_id = reg.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM sos_report s
      LEFT JOIN Clients c ON s.outlet_id = c.id
      LEFT JOIN SalesRep sr ON s.rep_id = sr.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;

    const params = [];
    const countParams = [];
    const whereConditions = [];

    // Date filtering (date stored as varchar, assume YYYY-MM-DD)
    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
      countParams.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
      countParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
      countParams.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
      countParams.push(endDate);
    } else {
      // Default to today if no date provided
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) = ?`);
      params.push(today);
      countParams.push(today);
    }

    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
      countParams.push(outlet);
    }

    if (rep && rep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(rep);
      countParams.push(rep);
    }

    if (brand && brand !== 'all') {
      whereConditions.push(`s.brand_name = ?`);
      params.push(brand);
      countParams.push(brand);
    }

    if (outletAccount && outletAccount !== 'all') {
      whereConditions.push(`oa.name = ?`);
      params.push(outletAccount);
      countParams.push(outletAccount);
    }

    if (targetStatus && targetStatus !== 'all') {
      // Use same thresholds as frontend status logic
      whereConditions.push(`CASE
        WHEN s.sos >= s.outlet_target THEN 'on_or_above'
        WHEN s.outlet_target - s.sos <= 10 THEN 'slightly_below'
        ELSE 'significantly_below'
      END = ?`);
      params.push(targetStatus);
      countParams.push(targetStatus);
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        c.name LIKE ? OR
        sr.name LIKE ? OR
        s.brand_name LIKE ? OR
        s.comment LIKE ?
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

    sql += ` ORDER BY STR_TO_DATE(s.date, '%Y-%m-%d') DESC, s.id DESC`;

    if (!isViewAll) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit, 10), offset);
    }

    console.log(
      `Fetching SOS reports with date filter: ${startDate || endDate || currentDate || 'today'}`,
    );

    const [results] = await db.query(sql, params);
    const [countResult] = await db.query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    console.log(`SOS query returned ${results.length} reports out of ${total} total`);

    res.json({
      success: true,
      data: results,
      pagination: {
        page: isViewAll ? 1 : parseInt(page, 10),
        limit: isViewAll ? total : parseInt(limit, 10),
        total,
        totalPages: isViewAll ? 1 : Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    console.error('Error fetching SOS reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Export SOS reports as CSV
exports.exportSosReportsCSV = async (req, res) => {
  try {
    console.log('SOS reports CSV export route hit!');

    const {
      startDate,
      endDate,
      currentDate,
      outlet,
      rep,
      brand,
      outletAccount,
      targetStatus,
      search,
    } = req.query;

    let sql = `
      SELECT 
        s.id,
        s.rep_id,
        s.appoint_id,
        s.outlet_id,
        s.brand_id,
        s.brand_name,
        s.brand_facings,
        s.total_facings,
        s.sos,
        s.outlet_target,
        s.comment,
        s.date,
        c.name AS outletName,
        sr.name AS repName,
        reg.name AS regionName,
        oc.name AS outletTypeName,
        oa.name AS outletAccountName
      FROM sos_report s
      LEFT JOIN Clients c ON s.outlet_id = c.id
      LEFT JOIN SalesRep sr ON s.rep_id = sr.id
      LEFT JOIN Regions reg ON c.region_id = reg.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;

    const params = [];
    const whereConditions = [];

    if (currentDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) = ?`);
      params.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) >= ?`);
      params.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) <= ?`);
      params.push(endDate);
    } else {
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(STR_TO_DATE(s.date, '%Y-%m-%d')) = ?`);
      params.push(today);
    }

    if (outlet && outlet !== 'all') {
      whereConditions.push(`c.name = ?`);
      params.push(outlet);
    }

    if (rep && rep !== 'all') {
      whereConditions.push(`sr.name = ?`);
      params.push(rep);
    }

    if (brand && brand !== 'all') {
      whereConditions.push(`s.brand_name = ?`);
      params.push(brand);
    }

    if (outletAccount && outletAccount !== 'all') {
      whereConditions.push(`oa.name = ?`);
      params.push(outletAccount);
    }

    if (targetStatus && targetStatus !== 'all') {
      whereConditions.push(`CASE
        WHEN s.sos >= s.outlet_target THEN 'on_or_above'
        WHEN s.outlet_target - s.sos <= 10 THEN 'slightly_below'
        ELSE 'significantly_below'
      END = ?`);
      params.push(targetStatus);
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        c.name LIKE ? OR
        sr.name LIKE ? OR
        s.brand_name LIKE ? OR
        s.comment LIKE ?
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

    sql += ` ORDER BY STR_TO_DATE(s.date, '%Y-%m-%d') DESC, s.id DESC`;

    const [results] = await db.query(sql, params);

    const headers = [
      'ID',
      'Outlet',
      'Region',
      'Outlet Type',
      'Outlet Account',
      'Rep',
      'Brand',
      'Brand Facings',
      'Total Facings',
      'SOS (%)',
      'Outlet Target (%)',
      'Variance (Target - SOS)',
      'Status',
      'Date',
    ];

    const csvRows = [headers.join(',')];

    results.forEach((row) => {
      const sosVal = Number(row.sos || 0);
      const targetVal = Number(row.outlet_target || 0);
      const variance = targetVal - sosVal;

      // Match frontend status thresholds
      let status = 'Significantly Below';
      if (sosVal >= targetVal) {
        status = 'On / Above Target';
      } else if (targetVal - sosVal <= 10) {
        status = 'Slightly Below';
      }

      const values = [
        row.id || '',
        `"${(row.outletName || '').replace(/"/g, '""')}"`,
        `"${(row.regionName || '').replace(/"/g, '""')}"`,
        `"${(row.outletTypeName || '').replace(/"/g, '""')}"`,
        `"${(row.outletAccountName || '').replace(/"/g, '""')}"`,
        `"${(row.repName || '').replace(/"/g, '""')}"`,
        `"${(row.brand_name || '').replace(/"/g, '""')}"`,
        row.brand_facings != null ? row.brand_facings : '',
        row.total_facings != null ? row.total_facings : '',
        row.sos != null ? sosVal.toFixed(2) : '',
        row.outlet_target != null ? targetVal.toFixed(2) : '',
        variance.toFixed(2),
        `"${status}"`,
        row.date || '',
      ];
      csvRows.push(values.join(','));
    });

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=sos-reports-${new Date().toISOString().split('T')[0]}.csv`,
    );
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting SOS reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Distinct outlets used in SOS reports
exports.getSosReportOutlets = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT c.id, c.name
      FROM sos_report s
      INNER JOIN Clients c ON s.outlet_id = c.id
      ORDER BY c.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching SOS outlets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Distinct reps used in SOS reports
exports.getSosReportReps = async (req, res) => {
  try {
    let sql = `
      SELECT DISTINCT sr.id, sr.name
      FROM sos_report s
      INNER JOIN SalesRep sr ON s.rep_id = sr.id
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
    console.error('Error fetching SOS reps:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Distinct outlet accounts used in SOS reports
exports.getSosReportOutletAccounts = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT oa.id, oa.name
      FROM sos_report s
      INNER JOIN Clients c ON s.outlet_id = c.id
      INNER JOIN outlet_accounts oa ON c.outlet_account = oa.id
      ORDER BY oa.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching SOS outlet accounts:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

