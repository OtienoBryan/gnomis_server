const db = require('../database/db');

exports.getAllPromotionsReports = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      currentDate,
      page = 1,
      limit = 10,
      outlet,
      salesRep,
      activationType,
      search
    } = req.query;

    const isViewAll = parseInt(limit, 10) === -1;
    const offset = isViewAll ? 0 : (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let sql = `
      SELECT mp.id, mp.user_name, mp.user_id, mp.admin_id, mp.outlet_id, mp.appoint_id,
             mp.product, mp.activation_type, mp.qty_samples_given, mp.qty_before, mp.qty_after,
             mp.comment, mp.created_at,
             c.name AS outletName,
             sr.name AS salesRepName,
             reg.name AS regionName,
             oc.name AS outletTypeName,
             oa.name AS outletAccountName
      FROM my_promotions mp
      LEFT JOIN Clients c ON (
        CAST(c.id AS CHAR) = TRIM(mp.outlet_id)
        OR CAST(c.outlet_account AS CHAR) = TRIM(mp.outlet_id)
        OR c.name = TRIM(mp.outlet_id)
      )
      LEFT JOIN SalesRep sr ON CAST(sr.id AS CHAR) = mp.user_id
      LEFT JOIN Regions reg ON c.region_id = reg.id
      LEFT JOIN outlet_categories oc ON c.client_type = oc.id
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM my_promotions mp
      LEFT JOIN Clients c ON (
        CAST(c.id AS CHAR) = TRIM(mp.outlet_id)
        OR CAST(c.outlet_account AS CHAR) = TRIM(mp.outlet_id)
        OR c.name = TRIM(mp.outlet_id)
      )
      LEFT JOIN SalesRep sr ON CAST(sr.id AS CHAR) = mp.user_id
    `;

    const params = [];
    const countParams = [];
    const whereConditions = [];

    if (currentDate) {
      whereConditions.push(`DATE(mp.created_at) = ?`);
      params.push(currentDate);
      countParams.push(currentDate);
    } else if (startDate && endDate) {
      whereConditions.push(`DATE(mp.created_at) BETWEEN ? AND ?`);
      params.push(startDate, endDate);
      countParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push(`DATE(mp.created_at) >= ?`);
      params.push(startDate);
      countParams.push(startDate);
    } else if (endDate) {
      whereConditions.push(`DATE(mp.created_at) <= ?`);
      params.push(endDate);
      countParams.push(endDate);
    } else {
      const today = new Date().toISOString().split('T')[0];
      whereConditions.push(`DATE(mp.created_at) = ?`);
      params.push(today);
      countParams.push(today);
    }

    if (outlet && outlet !== 'all') {
      whereConditions.push(`(c.name = ? OR TRIM(mp.outlet_id) = ?)`);
      params.push(outlet, outlet);
      countParams.push(outlet, outlet);
    }

    if (salesRep && salesRep !== 'all') {
      whereConditions.push(`(sr.name = ? OR mp.user_name = ?)`);
      params.push(salesRep, salesRep);
      countParams.push(salesRep, salesRep);
    }

    if (activationType && activationType !== 'all') {
      whereConditions.push(`mp.activation_type = ?`);
      params.push(activationType);
      countParams.push(activationType);
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        mp.product LIKE ? OR
        mp.comment LIKE ? OR
        mp.user_name LIKE ? OR
        c.name LIKE ? OR
        sr.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

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

    sql += ` ORDER BY mp.created_at DESC, mp.id DESC`;
    if (!isViewAll) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit, 10), offset);
    }

    const [results] = await db.query(sql, params);
    const [countResult] = await db.query(countSql, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: results,
      pagination: {
        page: isViewAll ? 1 : parseInt(page, 10),
        limit: isViewAll ? total : parseInt(limit, 10),
        total,
        totalPages: isViewAll ? 1 : Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (err) {
    console.error('Error fetching promotions reports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPromotionsOutlets = async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT c.id, c.name
      FROM my_promotions mp
      INNER JOIN Clients c ON (
        CAST(c.id AS CHAR) = TRIM(mp.outlet_id)
        OR CAST(c.outlet_account AS CHAR) = TRIM(mp.outlet_id)
        OR c.name = TRIM(mp.outlet_id)
      )
      ORDER BY c.name ASC
    `;
    const [results] = await db.query(sql);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error fetching promotions outlets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPromotionsSalesReps = async (req, res) => {
  try {
    let sql = `
      SELECT DISTINCT sr.id, sr.name
      FROM my_promotions mp
      INNER JOIN SalesRep sr ON CAST(sr.id AS CHAR) = mp.user_id
    `;

    const params = [];
    const whereConditions = [];

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
    console.error('Error fetching promotions sales reps:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
