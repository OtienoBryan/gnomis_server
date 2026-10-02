const db = require('../database/db');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const upload = multer({ storage: multer.memoryStorage() });

// Get all countries (preferably only those that have sales reps)
exports.getAllCountries = async (req, res) => {
  try {
    // Fetch distinct countries that have active sales reps
    const [rows] = await db.query(`
      SELECT DISTINCT c.id, c.name 
      FROM Country c
      INNER JOIN SalesRep sr ON sr.countryId = c.id
      WHERE sr.status = 1
      ORDER BY c.name
    `);
    
    // If no countries found with sales reps, fetch all countries
    if (rows.length === 0) {
      console.log('[getAllCountries] No countries found with sales reps, fetching all countries from Country table');
      const [allCountries] = await db.query('SELECT id, name FROM Country ORDER BY name');
      return res.json(allCountries);
    }
    
    console.log('[getAllCountries] Found', rows.length, 'countries with active sales reps');
    res.json(rows);
  } catch (err) {
    console.error('[getAllCountries] Error:', err);
    // Fallback: try to fetch all countries if the JOIN fails
    try {
      const [allCountries] = await db.query('SELECT id, name FROM Country ORDER BY name');
      console.log('[getAllCountries] Fallback: Returning all countries from Country table');
      res.json(allCountries);
    } catch (fallbackErr) {
      console.error('[getAllCountries] Fallback also failed:', fallbackErr);
      res.status(500).json({ error: 'Failed to fetch countries', details: err.message });
    }
  }
};

// Get all regions (optionally by country_id)
exports.getAllRegions = async (req, res) => {
  try {
    let query = 'SELECT * FROM Regions';
    const params = [];
    if (req.query.country_id) {
      query += ' WHERE countryId = ?';
      params.push(req.query.country_id);
    }
    query += ' ORDER BY name';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch regions', details: err.message });
  }
};

// Get all routes
exports.getAllRoutes = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM routes ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routes', details: err.message });
  }
};

// Get all sales reps
exports.getAllSalesReps = async (req, res) => {
  try {
    const { status, country, leader_id, region } = req.query;
    
    // Check if role column exists, if not use SELECT * and add default role
    let query = 'SELECT * FROM SalesRep';
    let params = [];
    const where = [];
    
    if (status !== undefined) {
      where.push('status = ?');
      params.push(status);
    }
    
    if (country) {
      where.push('country = ?');
      params.push(country);
    }
    
    if (leader_id) {
      where.push('leader_id = ?');
      params.push(leader_id);
    }
    
    if (region) {
      where.push('region = ?');
      params.push(region);
    }
    
    if (where.length > 0) {
      query += ' WHERE ' + where.join(' AND ');
    }
    
    query += ' ORDER BY name';
    
    const [rows] = await db.query(query, params);
    
    // Ensure role field exists in response, defaulting to 'sales rep' if missing
    const rowsWithRole = rows.map(row => ({
      ...row,
      role: row.role || 'sales rep'
    }));
    
    res.json(rowsWithRole);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sales reps', details: err.message });
  }
};

// Two phone numbers are the same when their last 9 digits match, so
// "0712 345 678", "+254 712-345-678" and "254712345678" count as one number.
const phoneKey = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
};

// Returns the staff member already using this phone number, if any.
// Compared in JavaScript (not SQL) so odd characters or spacing in stored numbers can't hide a duplicate.
const findStaffByPhone = async (phone, excludeId) => {
  const key = phoneKey(phone);
  if (!key) return null;
  const [rows] = await db.query('SELECT id, name, phoneNumber FROM SalesRep WHERE phoneNumber IS NOT NULL');
  return rows.find(r => String(r.id) !== String(excludeId) && phoneKey(r.phoneNumber) === key) || null;
};

// Create a new sales rep
exports.createSalesRep = async (req, res) => {
  const { name, email, phoneNumber, country, region, route, photo, role, expected_weekly_coverage, basic_salary } = req.body;
  try {
    const duplicate = await findStaffByPhone(phoneNumber);
    if (duplicate) {
      return res.status(409).json({ error: `This phone number is already used by ${duplicate.name}` });
    }

    let region_id = null;
    if (region && region !== '') {
      try {
        const [regionRows] = await db.query('SELECT id FROM Regions WHERE name = ?', [region]);
        if (regionRows.length > 0) {
          region_id = regionRows[0].id;
        } else {
          const [regionRowsLower] = await db.query('SELECT id FROM regions WHERE name = ?', [region]);
          if (regionRowsLower.length > 0) region_id = regionRowsLower[0].id;
        }
      } catch (e) {
        console.log('Error looking up region_id:', e.message);
      }
    }

    let route_id_update = null;
    if (route && route !== '') {
      try {
        const [routeRows] = await db.query('SELECT id FROM routes WHERE name = ?', [route]);
        if (routeRows.length > 0) route_id_update = routeRows[0].id;
      } catch (e) {
        console.log('Error looking up route_id_update:', e.message);
      }
    }

    const [result] = await db.query(
      'INSERT INTO SalesRep (name, email, phoneNumber, country, region, region_id, route_name_update, route_id_update, photoUrl, role, expected_weekly_coverage, basic_salary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, phoneNumber, country, region, region_id, route, route_id_update, photo, role || 'sales rep', expected_weekly_coverage || null, basic_salary || null]
    );
    res.status(201).json({
      id: result.insertId,
      name,
      email,
      phoneNumber,
      country,
      region,
      region_id,
      route,
      route_id_update,
      photo,
      role: role || 'sales rep',
      expected_weekly_coverage: expected_weekly_coverage || null,
      basic_salary: basic_salary || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create sales rep', details: err.message });
  }
};

// Update a sales rep
exports.updateSalesRep = async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, country, region, route_name_update, photoUrl, role, expected_weekly_coverage, basic_salary } = req.body;
  console.log('Update Sales Rep called');
  console.log('Params id:', id);
  console.log('Body:', req.body);
  try {
    if (phone !== undefined) {
      const duplicate = await findStaffByPhone(phone, id);
      if (duplicate) {
        return res.status(409).json({ error: `This phone number is already used by ${duplicate.name}` });
      }
    }

    // Look up region_id from region name if region is provided
    let region_id = null;
    if (region && region !== '') {
      try {
        // Try Regions table first (capital R)
        const [regionRows] = await db.query('SELECT id FROM Regions WHERE name = ?', [region]);
        if (regionRows.length > 0) {
          region_id = regionRows[0].id;
          console.log('Found region_id:', region_id, 'for region:', region);
        } else {
          // Try regions table (lowercase r)
          const [regionRowsLower] = await db.query('SELECT id FROM regions WHERE name = ?', [region]);
          if (regionRowsLower.length > 0) {
            region_id = regionRowsLower[0].id;
            console.log('Found region_id:', region_id, 'for region:', region);
          } else {
            console.log('Region not found:', region);
          }
        }
      } catch (err) {
        console.log('Error looking up region_id:', err.message);
      }
    }
    
    // Look up route_id from route name if route_name_update is provided
    let route_id_update = null;
    if (route_name_update && route_name_update !== '') {
      try {
        const [routeRows] = await db.query('SELECT id FROM routes WHERE name = ?', [route_name_update]);
        if (routeRows.length > 0) {
          route_id_update = routeRows[0].id;
          console.log('Found route_id_update:', route_id_update, 'for route:', route_name_update);
        } else {
          console.log('Route not found:', route_name_update);
        }
      } catch (err) {
        console.log('Error looking up route_id_update:', err.message);
      }
    }
    
    // Build UPDATE query with region_id and route_id_update
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phoneNumber = ?'); values.push(phone); }
    if (country !== undefined) { updates.push('country = ?'); values.push(country); }
    if (region !== undefined) { updates.push('region = ?'); values.push(region); }
    if (region_id !== null) { updates.push('region_id = ?'); values.push(region_id); }
    if (route_name_update !== undefined) { updates.push('route_name_update = ?'); values.push(route_name_update); }
    if (route_id_update !== null) { updates.push('route_id_update = ?'); values.push(route_id_update); }
    if (photoUrl !== undefined) { updates.push('photoUrl = ?'); values.push(photoUrl); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role || 'sales rep'); }
    if (expected_weekly_coverage !== undefined) { updates.push('expected_weekly_coverage = ?'); values.push(expected_weekly_coverage || null); }
    if (basic_salary !== undefined) { updates.push('basic_salary = ?'); values.push(basic_salary || null); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }
    
    values.push(id);
    
    console.log('SQL UPDATE:', `UPDATE SalesRep SET ${updates.join(', ')} WHERE id = ?`);
    console.log('SQL values:', values);
    
    await db.query(
      `UPDATE SalesRep SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    res.json({ 
      id, 
      name, 
      email, 
      phone, 
      country, 
      region, 
      region_id,
      route_name_update,
      route_id_update,
      photoUrl,
      role: role || 'sales rep',
      expected_weekly_coverage: expected_weekly_coverage || null,
      basic_salary: basic_salary || null
    });
  } catch (err) {
    console.error('Error updating sales rep:', err);
    res.status(500).json({ error: 'Failed to update sales rep', details: err.message });
  }
};

// Update status of a sales rep
exports.updateSalesRepStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (typeof status !== 'number') {
    return res.status(400).json({ error: 'Status must be a number (0 or 1)' });
  }
  try {
    await db.query('UPDATE SalesRep SET status = ? WHERE id = ?', [status, id]);
    const [rows] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Sales rep not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update sales rep status', details: err.message });
  }
};

// Update device status of a sales rep (0 = unlocked, 1 = locked)
exports.updateDeviceStatus = async (req, res) => {
  const { id } = req.params;
  const { device_status } = req.body;
  if (device_status !== 0 && device_status !== 1) {
    return res.status(400).json({ error: 'device_status must be 0 (unlocked) or 1 (locked)' });
  }
  try {
    await db.query('UPDATE SalesRep SET device_status = ? WHERE id = ?', [device_status, id]);
    const [rows] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Sales rep not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update device status', details: err.message });
  }
};

// Delete a sales rep
exports.deleteSalesRep = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM SalesRep WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sales rep', details: err.message });
  }
}; 

// Upload sales rep photo to Cloudinary
exports.uploadSalesRepPhoto = [
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      // Convert buffer to base64 for Cloudinary
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'sales_reps',
        resource_type: 'image',
      });
      res.json({ url: result.secure_url });
    } catch (err) {
      console.error('Cloudinary upload error:', err); // <-- Add this line
      res.status(500).json({ error: 'Failed to upload photo', details: err.message });
    }
  }
]; 

// Get all managers assigned to a sales rep
exports.getSalesRepManagers = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    const [rows] = await db.query(
      `SELECT srm.id, srm.manager_id, srm.manager_type, m.name, m.email, m.phoneNumber, m.country, m.region
       FROM sales_rep_managers srm
       JOIN managers m ON srm.manager_id = m.id
       WHERE srm.sales_rep_id = ?`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assigned managers', details: err.message });
  }
};

// Assign managers to a sales rep (replace all assignments)
exports.assignManagersToSalesRep = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { assignments } = req.body; // [{ manager_id, manager_type }]
  if (!Array.isArray(assignments)) {
    return res.status(400).json({ error: 'Assignments must be an array' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM sales_rep_managers WHERE sales_rep_id = ?', [id]);
    for (const a of assignments) {
      await conn.query(
        'INSERT INTO sales_rep_managers (sales_rep_id, manager_id, manager_type) VALUES (?, ?, ?)',
        [id, a.manager_id, a.manager_type]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Failed to assign managers', details: err.message });
  } finally {
    conn.release();
  }
};

// Get all team leaders from staff table where role = 'leader'
exports.getAllTeamLeaders = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, business_email as email, phone_number as phoneNumber, 
              NULL as country, NULL as region, NULL as route_name_update, 
              photo_url as photoUrl, 
              CASE WHEN is_active = 1 OR is_active IS NULL THEN 1 ELSE 0 END as status
       FROM staff
       WHERE LOWER(TRIM(role)) = 'leader' 
         AND (is_active = 1 OR is_active IS NULL)
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch team leaders', details: err.message });
  }
};

// Get team leader assigned to a sales rep (from staff table where role = 'leader')
exports.getSalesRepTeamLeader = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    // First try to get from leader_id column in SalesRep table (now references staff.id)
    const [salesRepRows] = await db.query(
      `SELECT sr.leader_id, s.id, s.name, s.business_email as email, s.phone_number as phoneNumber
       FROM SalesRep sr
       LEFT JOIN staff s ON sr.leader_id = s.id AND LOWER(TRIM(s.role)) = 'leader'
       WHERE sr.id = ? AND sr.leader_id IS NOT NULL
       LIMIT 1`,
      [id]
    );
    
    if (salesRepRows.length > 0 && salesRepRows[0].leader_id && salesRepRows[0].id) {
      return res.json({
        id: salesRepRows[0].id,
        name: salesRepRows[0].name,
        email: salesRepRows[0].email,
        phoneNumber: salesRepRows[0].phoneNumber
      });
    }
    
    // Fallback to junction table if leader_id is not set
    const [tableCheck] = await db.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'sales_rep_team_leaders'
    `);
    
    if (tableCheck[0].count === 0) {
      return res.json(null);
    }

    const [rows] = await db.query(
      `SELECT srtl.team_leader_id, s.id, s.name, s.business_email as email, s.phone_number as phoneNumber
       FROM sales_rep_team_leaders srtl
       JOIN staff s ON srtl.team_leader_id = s.id AND LOWER(TRIM(s.role)) = 'leader'
       WHERE srtl.sales_rep_id = ?
       LIMIT 1`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.json(null);
    }
    
    res.json(rows[0]);
  } catch (err) {
    // If error, return null
    res.json(null);
  }
};

// Assign team leader to a sales rep (team leader must be from staff table where role = 'leader')
exports.assignTeamLeaderToSalesRep = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { team_leader_id } = req.body;
  
  if (!team_leader_id) {
    return res.status(400).json({ error: 'team_leader_id is required' });
  }

  // Check if the sales rep exists
  const [salesRepCheck] = await db.query(
    `SELECT id FROM SalesRep WHERE id = ?`,
    [id]
  );
  
  if (salesRepCheck.length === 0) {
    return res.status(404).json({ error: 'Sales rep not found' });
  }
  
  // Verify that the team_leader_id exists in staff table with role = 'leader'
  const [teamLeaderCheck] = await db.query(
    `SELECT id, name FROM staff WHERE id = ? AND LOWER(TRIM(role)) = 'leader'`,
    [team_leader_id]
  );
  
  if (teamLeaderCheck.length === 0) {
    return res.status(404).json({ error: 'Team leader not found. Team leaders must be from staff table with role = "leader"' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    // Add leader_id column to SalesRep table if it doesn't exist
    try {
      await conn.query(`
        ALTER TABLE SalesRep 
        ADD COLUMN IF NOT EXISTS leader_id INT NULL
      `);
    } catch (alterErr) {
      // Column might already exist, ignore error
      if (!alterErr.message.includes('Duplicate column name')) {
        throw alterErr;
      }
    }
    
    // Create table if it doesn't exist (team_leader_id now references staff.id)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sales_rep_team_leaders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        sales_rep_id INT NOT NULL,
        team_leader_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_sales_rep_team_leader (sales_rep_id, team_leader_id),
        FOREIGN KEY (sales_rep_id) REFERENCES SalesRep(id) ON DELETE CASCADE
      )
    `);
    
    // Try to drop old foreign key if it exists and add new one referencing staff table
    try {
      await conn.query(`
        ALTER TABLE sales_rep_team_leaders 
        DROP FOREIGN KEY IF EXISTS sales_rep_team_leaders_ibfk_2
      `);
    } catch (dropErr) {
      // Foreign key might not exist or have different name, ignore
    }
    
    // Add foreign key to staff table if it doesn't exist
    try {
      await conn.query(`
        ALTER TABLE sales_rep_team_leaders 
        ADD CONSTRAINT fk_team_leader_staff 
        FOREIGN KEY (team_leader_id) REFERENCES staff(id) ON DELETE CASCADE
      `);
    } catch (fkErr) {
      // Foreign key might already exist, ignore
      if (!fkErr.message.includes('Duplicate foreign key')) {
        // Log but don't fail - the constraint might already be correct
        console.log('Note: Could not add foreign key constraint:', fkErr.message);
      }
    }
    
    // Update leader_id in SalesRep table
    await conn.query(
      'UPDATE SalesRep SET leader_id = ? WHERE id = ?',
      [team_leader_id, id]
    );
    
    // Delete existing team leader assignment for this sales rep
    await conn.query('DELETE FROM sales_rep_team_leaders WHERE sales_rep_id = ?', [id]);
    
    // Insert new assignment
    await conn.query(
      'INSERT INTO sales_rep_team_leaders (sales_rep_id, team_leader_id) VALUES (?, ?)',
      [id, team_leader_id]
    );
    
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Failed to assign team leader', details: err.message });
  } finally {
    conn.release();
  }
};

// Unassign team leader from a sales rep
exports.unassignTeamLeaderFromSalesRep = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    // Update leader_id to NULL in SalesRep table
    await conn.query('UPDATE SalesRep SET leader_id = NULL WHERE id = ?', [id]);
    
    // Delete from junction table
    await conn.query('DELETE FROM sales_rep_team_leaders WHERE sales_rep_id = ?', [id]);
    
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Failed to unassign team leader', details: err.message });
  } finally {
    conn.release();
  }
};

// Unassign a manager from a sales rep
exports.unassignManagerFromSalesRep = async (req, res) => {
  const { id, managerId } = req.params;
  try {
    await db.query('DELETE FROM sales_rep_managers WHERE sales_rep_id = ? AND manager_id = ?', [id, managerId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unassign manager', details: err.message });
  }
}; 

// Get a single sales rep by ID
exports.getSalesRepById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Sales rep not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sales rep', details: err.message });
  }
}; 

// Get key account targets for a sales rep (ordered by month)
exports.getKeyAccountTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    const [rows] = await db.query('SELECT * FROM key_account_targets WHERE sales_rep_id = ? ORDER BY target_month DESC, created_at DESC', [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch key account targets', details: err.message });
  }
};

// Add key account targets for a sales rep
exports.addKeyAccountTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    // Prevent duplicate month
    const [existing] = await db.query('SELECT id FROM key_account_targets WHERE sales_rep_id = ? AND target_month = ?', [id, target_month]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Target for this month already exists' });
    }
    const [result] = await db.query(
      'INSERT INTO key_account_targets (sales_rep_id, vapes_targets, pouches_targets, new_outlets_targets, target_month) VALUES (?, ?, ?, ?, ?)',
      [id, vapes_targets, pouches_targets, new_outlets_targets, target_month]
    );
    res.status(201).json({ id: result.insertId, sales_rep_id: id, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add key account targets', details: err.message });
  }
}; 

// Update key account target
exports.updateKeyAccountTarget = async (req, res) => {
  const { targetId } = req.params;
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    await db.query(
      'UPDATE key_account_targets SET vapes_targets = ?, pouches_targets = ?, new_outlets_targets = ?, target_month = ? WHERE id = ?',
      [vapes_targets, pouches_targets, new_outlets_targets, target_month, targetId]
    );
    res.json({ id: targetId, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update key account target', details: err.message });
  }
};

// Delete key account target
exports.deleteKeyAccountTarget = async (req, res) => {
  const { targetId } = req.params;
  try {
    await db.query('DELETE FROM key_account_targets WHERE id = ?', [targetId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete key account target', details: err.message });
  }
}; 

// Get retail targets for a sales rep (ordered by month)
exports.getRetailTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    const [rows] = await db.query('SELECT * FROM retail_targets WHERE sales_rep_id = ? ORDER BY target_month DESC, created_at DESC', [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch retail targets', details: err.message });
  }
};

// Add retail targets for a sales rep
exports.addRetailTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    // Prevent duplicate month
    const [existing] = await db.query('SELECT id FROM retail_targets WHERE sales_rep_id = ? AND target_month = ?', [id, target_month]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Target for this month already exists' });
    }
    const [result] = await db.query(
      'INSERT INTO retail_targets (sales_rep_id, vapes_targets, pouches_targets, new_outlets_targets, target_month) VALUES (?, ?, ?, ?, ?)',
      [id, vapes_targets, pouches_targets, new_outlets_targets, target_month]
    );
    res.status(201).json({ id: result.insertId, sales_rep_id: id, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add retail targets', details: err.message });
  }
};

// Update retail target
exports.updateRetailTarget = async (req, res) => {
  const { targetId } = req.params;
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    await db.query(
      'UPDATE retail_targets SET vapes_targets = ?, pouches_targets = ?, new_outlets_targets = ?, target_month = ? WHERE id = ?',
      [vapes_targets, pouches_targets, new_outlets_targets, target_month, targetId]
    );
    res.json({ id: targetId, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update retail target', details: err.message });
  }
};

// Delete retail target
exports.deleteRetailTarget = async (req, res) => {
  const { targetId } = req.params;
  try {
    await db.query('DELETE FROM retail_targets WHERE id = ?', [targetId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete retail target', details: err.message });
  }
}; 

// Get distributors targets for a sales rep (ordered by month)
exports.getDistributorsTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    const [rows] = await db.query('SELECT * FROM distributors_targets WHERE sales_rep_id = ? ORDER BY target_month DESC, created_at DESC', [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch distributors targets', details: err.message });
  }
};

// Add distributors targets for a sales rep
exports.addDistributorsTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    // Prevent duplicate month
    const [existing] = await db.query('SELECT id FROM distributors_targets WHERE sales_rep_id = ? AND target_month = ?', [id, target_month]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Target for this month already exists' });
    }
    const [result] = await db.query(
      'INSERT INTO distributors_targets (sales_rep_id, vapes_targets, pouches_targets, new_outlets_targets, target_month) VALUES (?, ?, ?, ?, ?)',
      [id, vapes_targets, pouches_targets, new_outlets_targets, target_month]
    );
    res.status(201).json({ id: result.insertId, sales_rep_id: id, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add distributors targets', details: err.message });
  }
};

// Update distributors target
exports.updateDistributorsTarget = async (req, res) => {
  const { targetId } = req.params;
  const { vapes_targets, pouches_targets, new_outlets_targets, target_month } = req.body;
  if (!target_month) return res.status(400).json({ error: 'target_month is required' });
  try {
    await db.query(
      'UPDATE distributors_targets SET vapes_targets = ?, pouches_targets = ?, new_outlets_targets = ?, target_month = ? WHERE id = ?',
      [vapes_targets, pouches_targets, new_outlets_targets, target_month, targetId]
    );
    res.json({ id: targetId, vapes_targets, pouches_targets, new_outlets_targets, target_month });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update distributors target', details: err.message });
  }
};

// Delete distributors target
exports.deleteDistributorsTarget = async (req, res) => {
  const { targetId } = req.params;
  try {
    await db.query('DELETE FROM distributors_targets WHERE id = ?', [targetId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete distributors target', details: err.message });
  }
};

// General Sales Rep Targets Management
// Get targets for a specific sales rep
exports.getSalesRepTargets = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { year } = req.query;
  try {
    let query = 'SELECT * FROM sales_rep_targets WHERE sales_rep_id = ?';
    let params = [id];
    
    if (year) {
      query += ' AND year = ?';
      params.push(year);
    }
    
    query += ' ORDER BY year DESC, month DESC, created_at DESC';
    
    const [rows] = await db.query(query, params);
    
    // Transform the data to match frontend expectations
    const transformedRows = rows.map(row => ({
      id: row.id,
      salesRepId: row.sales_rep_id,
      year: row.year,
      month: row.month,
      vapesTarget: row.vapes_target,
      pouchesTarget: row.pouches_target,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    
    res.json(transformedRows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sales rep targets', details: err.message });
  }
};

// Create or update a target for a sales rep
exports.setSalesRepTarget = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { year, month, vapesTarget, pouchesTarget } = req.body;
  
  if (!year || !month) {
    return res.status(400).json({ error: 'Year and month are required' });
  }
  
  try {
    // Check if target already exists for this sales rep, year, and month
    const [existing] = await db.query(
      'SELECT id FROM sales_rep_targets WHERE sales_rep_id = ? AND year = ? AND month = ?',
      [id, year, month]
    );
    
    if (existing.length > 0) {
      // Update existing target
      await db.query(
        'UPDATE sales_rep_targets SET vapes_target = ?, pouches_target = ?, updated_at = NOW() WHERE id = ?',
        [vapesTarget || 0, pouchesTarget || 0, existing[0].id]
      );
      res.json({ 
        id: existing[0].id, 
        salesRepId: parseInt(id), 
        year, 
        month, 
        vapesTarget: vapesTarget || 0, 
        pouchesTarget: pouchesTarget || 0 
      });
    } else {
      // Create new target
      const [result] = await db.query(
        'INSERT INTO sales_rep_targets (sales_rep_id, year, month, vapes_target, pouches_target) VALUES (?, ?, ?, ?, ?)',
        [id, year, month, vapesTarget || 0, pouchesTarget || 0]
      );
      res.status(201).json({ 
        id: result.insertId, 
        salesRepId: parseInt(id), 
        year, 
        month, 
        vapesTarget: vapesTarget || 0, 
        pouchesTarget: pouchesTarget || 0 
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to set sales rep target', details: err.message });
  }
};

// Update an existing target
exports.updateSalesRepTarget = async (req, res) => {
  const { targetId } = req.params;
  const { year, month, vapesTarget, pouchesTarget } = req.body;
  
  try {
    await db.query(
      'UPDATE sales_rep_targets SET year = ?, month = ?, vapes_target = ?, pouches_target = ?, updated_at = NOW() WHERE id = ?',
      [year, month, vapesTarget || 0, pouchesTarget || 0, targetId]
    );
    res.json({ 
      id: parseInt(targetId), 
      year, 
      month, 
      vapesTarget: vapesTarget || 0, 
      pouchesTarget: pouchesTarget || 0 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update sales rep target', details: err.message });
  }
};

// Delete a target
exports.deleteSalesRepTarget = async (req, res) => {
  const { targetId } = req.params;
  try {
    await db.query('DELETE FROM sales_rep_targets WHERE id = ?', [targetId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sales rep target', details: err.message });
  }
}; 

// Get manager assignments (one per type) for a sales rep
exports.getManagerAssignments = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  try {
    const [rows] = await db.query(
      `SELECT srm.manager_type, srm.manager_id, m.name, m.email, m.phoneNumber
       FROM sales_rep_manager_assignments srm
       JOIN managers m ON srm.manager_id = m.id
       WHERE srm.sales_rep_id = ?`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch manager assignments', details: err.message });
  }
};

// Set manager assignments for a sales rep (one per type)
exports.setManagerAssignments = async (req, res) => {
  const { id } = req.params; // sales_rep_id
  const { assignments } = req.body; // [{ manager_type, manager_id }]
  if (!Array.isArray(assignments)) {
    return res.status(400).json({ error: 'Assignments must be an array' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM sales_rep_manager_assignments WHERE sales_rep_id = ?', [id]);
    for (const a of assignments) {
      if (a.manager_id && a.manager_type) {
        await conn.query(
          'INSERT INTO sales_rep_manager_assignments (sales_rep_id, manager_id, manager_type) VALUES (?, ?, ?)',
          [id, a.manager_id, a.manager_type]
        );
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Failed to set manager assignments', details: err.message });
  } finally {
    conn.release();
  }
}; 

// Add a new country
exports.addCountry = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Country name is required' });
  try {
    const [result] = await db.query('INSERT INTO countries (name) VALUES (?)', [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add country', details: err.message });
  }
};

// Add a new region
exports.addRegion = async (req, res) => {
  const { name, country_id } = req.body;
  if (!name || !country_id) return res.status(400).json({ error: 'Region name and country_id are required' });
  try {
    const [result] = await db.query('INSERT INTO regions (name, country_id) VALUES (?, ?)', [name, country_id]);
    res.status(201).json({ id: result.insertId, name, country_id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add region', details: err.message });
  }
};

// Add a new route
exports.addRoute = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name is required' });
  try {
    const [result] = await db.query('INSERT INTO routes (name) VALUES (?)', [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add route', details: err.message });
  }
}; 

// Get sales rep performance (targets vs sales by client type)
exports.getSalesRepPerformance = async (req, res) => {
  try {
    console.log('[getSalesRepPerformance] Starting...');
    const { start_date, end_date } = req.query;
    console.log('[getSalesRepPerformance] Query params:', { start_date, end_date });

    // Check if required tables exist
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('SalesRep', 'distributors_targets', 'key_account_targets', 'retail_targets', 'Clients', 'sales_orders', 'sales_order_items', 'products')
    `);
    
    const existingTables = tables.map(t => t.TABLE_NAME);
    const requiredTables = ['SalesRep', 'distributors_targets', 'key_account_targets', 'retail_targets', 'Clients', 'sales_orders', 'sales_order_items', 'products'];
    const missingTables = requiredTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log('[getSalesRepPerformance] Missing tables:', missingTables);
      return res.status(400).json({ 
        success: false, 
        error: `Missing required tables: ${missingTables.join(', ')}. Please run the database setup script.` 
      });
    }

    // 1. Get all active sales reps (include route_id_update, route name, and region)
    console.log('[getSalesRepPerformance] Querying SalesRep table...');
    const [salesReps] = await db.query(`
      SELECT s.id, s.name, s.route_id_update, r.name AS route_name, s.region, rg.name AS region_name, s.country
      FROM SalesRep s
      LEFT JOIN routes r ON s.route_id_update = r.id
      LEFT JOIN Regions rg ON s.region = rg.id OR s.region = rg.name
      WHERE s.status = 1
    `);
    console.log('[getSalesRepPerformance] Active SalesReps found:', salesReps.length);
    console.log('[getSalesRepPerformance] Sample sales rep data:', salesReps.slice(0, 3).map(rep => ({ id: rep.id, name: rep.name })));

    // 2. Get all targets for each type, filtered by date range if provided
    function filterTargets(targets) {
      if (!start_date && !end_date) return targets;
      return targets.filter(t => {
        const tStart = t.start_date ? new Date(t.start_date) : null;
        const tEnd = t.end_date ? new Date(t.end_date) : null;
        const sDate = start_date ? new Date(start_date) : null;
        const eDate = end_date ? new Date(end_date) : null;
        // Overlap logic: target is valid if its range overlaps with filter range
        if (tStart && eDate && tStart > eDate) return false;
        if (tEnd && sDate && tEnd < sDate) return false;
        return true;
      });
    }
    
    console.log('[getSalesRepPerformance] Querying targets tables...');
    const [distributorTargetsRaw] = await db.query('SELECT * FROM distributors_targets');
    const [keyAccountTargetsRaw] = await db.query('SELECT * FROM key_account_targets');
    const [retailTargetsRaw] = await db.query('SELECT * FROM retail_targets');
    console.log('[getSalesRepPerformance] Targets found:', {
      distributors: distributorTargetsRaw.length,
      keyAccounts: keyAccountTargetsRaw.length,
      retail: retailTargetsRaw.length
    });
    
    const distributorTargets = filterTargets(distributorTargetsRaw);
    const keyAccountTargets = filterTargets(keyAccountTargetsRaw);
    const retailTargets = filterTargets(retailTargetsRaw);

    // 3. Get all clients with their type and route_id_update
    console.log('[getSalesRepPerformance] Querying Clients table...');
    const [clients] = await db.query('SELECT id, client_type, route_id_update FROM Clients');
    console.log('[getSalesRepPerformance] Clients found:', clients.length);

    // 4. Get all sales_order_items joined with sales_orders, client, products, and Category, filtered by order_date
    console.log('[getSalesRepPerformance] Querying sales data...');
    let salesQuery = `
      SELECT soi.*, so.client_id, so.order_date, c.client_type, c.route_id_update, p.category_id
      FROM sales_order_items soi
      JOIN sales_orders so ON soi.sales_order_id = so.id
      JOIN Clients c ON so.client_id = c.id
      JOIN products p ON soi.product_id = p.id
    `;
    const salesParams = [];
    if (start_date && end_date) {
      salesQuery += ' WHERE so.order_date BETWEEN ? AND ?';
      salesParams.push(start_date, end_date);
    } else if (start_date) {
      salesQuery += ' WHERE so.order_date >= ?';
      salesParams.push(start_date);
    } else if (end_date) {
      salesQuery += ' WHERE so.order_date <= ?';
      salesParams.push(end_date);
    }
    const [sales] = await db.query(salesQuery, salesParams);
    console.log('[getSalesRepPerformance] Sales records found:', sales.length);

    // 5. Aggregate data (same as before)
    console.log('[getSalesRepPerformance] Processing performance data...');
    const performance = salesReps.map(rep => {
      // Find all clients for this rep by route_id_update
      const repClients = clients.filter(c => c.route_id_update === rep.route_id_update);
      const repClientIds = repClients.map(c => c.id);

      // For each client type, get targets, sales, and outlet stats
      function getTypeStats(clientType, targetObj, salesArr) {
        const typeClients = repClients.filter(c => c.client_type === clientType);
        const typeClientIds = typeClients.map(c => c.id);
        const total_outlets = typeClientIds.length;
        const outlets_with_orders = typeClientIds.filter(cid => salesArr.some(s => s.client_id === cid)).length;
        return {
          vapes_target: targetObj.vapes_targets || 0,
          pouches_target: targetObj.pouches_targets || 0,
          vapes_sales: salesArr.filter(s => typeClientIds.includes(s.client_id) && (s.category_id === 1 || s.category_id === 3)).reduce((sum, s) => sum + (s.quantity || 0), 0),
          pouches_sales: salesArr.filter(s => typeClientIds.includes(s.client_id) && (s.category_id === 4 || s.category_id === 5)).reduce((sum, s) => sum + (s.quantity || 0), 0),
          total_outlets,
          outlets_with_orders,
          outlet_pct: total_outlets > 0 ? (outlets_with_orders / total_outlets) * 100 : 0
        };
      }

      function pickTarget(targets, repId) {
        const filtered = targets.filter(t => t.sales_rep_id === repId);
        if (filtered.length === 0) return {};
        return filtered.reduce((latest, t) => {
          if (!latest.start_date) return t;
          if (t.start_date && new Date(t.start_date) > new Date(latest.start_date)) return t;
          return latest;
        }, filtered[0]);
      }

      const distTarget = pickTarget(distributorTargets, rep.id);
      const keyTarget = pickTarget(keyAccountTargets, rep.id);
      const retailTarget = pickTarget(retailTargets, rep.id);

      return {
        id: rep.id,
        name: rep.name,
        route_name: rep.route_name,
        region: rep.region_name || rep.region || '',
        country: rep.country || '',
        distributors: getTypeStats(3, distTarget, sales),
        key_accounts: getTypeStats(2, keyTarget, sales),
        retail: getTypeStats(1, retailTarget, sales)
      };
    });

    console.log('[getSalesRepPerformance] Success! Returning performance data for', performance.length, 'sales reps');
    res.json({ success: true, data: performance, debug_sales: sales });
  } catch (err) {
    console.error('[getSalesRepPerformance] Error:', err);
    console.error('[getSalesRepPerformance] Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get master sales data for all clients by year
exports.getMasterSalesData = async (req, res) => {
  try {
    const { year, category, salesRep, categoryGroup, startDate, endDate, clientStatus, viewType, page, limit, sortColumn, sortDirection, search } = req.query;
    const currentYear = year || new Date().getFullYear();
    const isQuantityView = viewType === 'quantity';
    
    // Pagination parameters
    const currentPage = parseInt(page) || 1;
    const itemsPerPage = parseInt(limit) || 25;
    const offset = (currentPage - 1) * itemsPerPage;
    
    // Parse category and salesRep as arrays
    const categories = category ? (Array.isArray(category) ? category : [category]) : [];
    const salesReps = salesRep ? (Array.isArray(salesRep) ? salesRep : [salesRep]) : [];

    console.log(`[Master Sales] Fetching page ${currentPage} with ${itemsPerPage} items (Sort: ${sortColumn || 'none'} ${sortDirection || ''}, Search: ${search || 'none'})`);

    // Build WHERE conditions
    const conditions = [];
    const params = [];
    
    // Search filter - searches all records, not just current page
    if (search && search.trim()) {
      conditions.push('c.name LIKE ?');
      params.push(`%${search.trim()}%`);
    }
    
    if (categories.length > 0) {
      conditions.push('cat.id IN (' + categories.map(() => '?').join(',') + ')');
      params.push(...categories);
    }
    if (categoryGroup === 'vapes') {
      conditions.push('p.category_id IN (1, 3)');
    } else if (categoryGroup === 'pouches') {
      conditions.push('p.category_id IN (4, 5)');
    }
    if (salesReps.length > 0) {
      conditions.push('sr.id IN (' + salesReps.map(() => '?').join(',') + ')');
      params.push(...salesReps);
    }
    if (startDate) {
      conditions.push('so.order_date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('so.order_date <= ?');
      params.push(endDate);
    }
    if (clientStatus === 'active') {
      conditions.push('c.id IN (SELECT DISTINCT client_id FROM sales_orders WHERE order_date >= DATE_SUB(CURDATE(), INTERVAL 45 DAY))');
    } else if (clientStatus === 'inactive') {
      conditions.push('c.id NOT IN (SELECT DISTINCT client_id FROM sales_orders WHERE order_date >= DATE_SUB(CURDATE(), INTERVAL 45 DAY))');
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count for pagination (optimized - counts clients, not rows)
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM Clients c
      LEFT JOIN sales_orders so ON c.id = so.client_id AND so.my_status IN (1, 2, 3, 7)
      LEFT JOIN sales_order_items soi ON so.id = soi.sales_order_id
      LEFT JOIN products p ON soi.product_id = p.id
      LEFT JOIN Category cat ON p.category_id = cat.id
      LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
      ${whereClause}
    `;
    
    const [countResult] = await db.query(countQuery, params);
    const totalClients = countResult[0].total;
    const totalPages = Math.ceil(totalClients / itemsPerPage);

    // OPTIMIZED: Get clients with their sales data for each month with PAGINATION
    const yearParams = Array(13).fill(currentYear); // 12 months + total
    const allParams = [...yearParams, ...params, itemsPerPage, offset];
    
    const [rows] = await db.query(`
      SELECT 
        c.id as client_id,
        c.name as client_name,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 1 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as january,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 2 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as february,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 3 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as march,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 4 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as april,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 5 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as may,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 6 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as june,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 7 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as july,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 8 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as august,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 9 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as september,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 10 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as october,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 11 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as november,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 12 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as december,
        COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as total
      FROM Clients c
      LEFT JOIN sales_orders so ON c.id = so.client_id AND so.my_status IN (1, 2, 3, 7)
      LEFT JOIN sales_order_items soi ON so.id = soi.sales_order_id
      LEFT JOIN products p ON soi.product_id = p.id
      LEFT JOIN Category cat ON p.category_id = cat.id
      LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
      ${whereClause}
      GROUP BY c.id, c.name
      ${(() => {
        // Build ORDER BY clause based on sortColumn and sortDirection
        if (sortColumn) {
          const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
          if (sortColumn === 'client_name') {
            return `ORDER BY c.name ${direction}`;
          } else if (sortColumn === 'total') {
            return `ORDER BY total ${direction}`;
          } else if (['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].includes(sortColumn)) {
            return `ORDER BY ${sortColumn} ${direction}`;
          }
        }
        return 'ORDER BY c.name'; // Default sort by client name
      })()}
      LIMIT ? OFFSET ?
    `, allParams);

    console.log(`[Master Sales] Returned ${rows.length} clients (Page ${currentPage}/${totalPages})`);

    // Calculate totals from ALL filtered records (not just current page)
    const totalsYearParams = Array(13).fill(currentYear); // 12 months + total
    const totalsParams = [...totalsYearParams, ...params];
    
    const [totalsResult] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 1 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as january,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 2 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as february,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 3 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as march,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 4 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as april,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 5 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as may,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 6 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as june,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 7 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as july,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 8 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as august,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 9 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as september,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 10 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as october,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 11 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as november,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 12 AND YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as december,
        COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? THEN ${isQuantityView ? 'soi.quantity' : 'soi.quantity * soi.unit_price'} ELSE 0 END), 0) as total
      FROM Clients c
      LEFT JOIN sales_orders so ON c.id = so.client_id AND so.my_status IN (1, 2, 3, 7)
      LEFT JOIN sales_order_items soi ON so.id = soi.sales_order_id
      LEFT JOIN products p ON soi.product_id = p.id
      LEFT JOIN Category cat ON p.category_id = cat.id
      LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
      ${whereClause}
    `, totalsParams);

    const totals = totalsResult[0] || {
      january: 0,
      february: 0,
      march: 0,
      april: 0,
      may: 0,
      june: 0,
      july: 0,
      august: 0,
      september: 0,
      october: 0,
      november: 0,
      december: 0,
      total: 0
    };

    // Return data with pagination metadata and totals
    res.json({
      success: true,
      data: rows,
      totals: totals,
      pagination: {
        currentPage,
        itemsPerPage,
        totalItems: totalClients,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1
      }
    });
  } catch (err) {
    console.error('Error fetching master sales data:', err);
    res.status(500).json({ error: 'Failed to fetch master sales data', details: err.message });
  }
};

// Get outlet visits summary (per outlet, per month, per year)
exports.getOutletVisitsSummary = async (req, res) => {
  try {
    const { year, startDate, endDate, page, limit, search, outletAccountId } = req.query;
    const currentYear = year || new Date().getFullYear();

    const currentPage = parseInt(page) || 1;
    const itemsPerPage = parseInt(limit) || 25;
    const offset = (currentPage - 1) * itemsPerPage;

    const conditions = [];
    const params = [];

    if (search && search.trim()) {
      conditions.push('c.name LIKE ?');
      params.push(`%${search.trim()}%`);
    }

    if (startDate) {
      conditions.push('DATE(jp.checkInTime) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(jp.checkInTime) <= ?');
      params.push(endDate);
    }

    if (outletAccountId) {
      conditions.push('c.outlet_account = ?');
      params.push(parseInt(outletAccountId, 10));
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count distinct outlets for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM Clients c
      LEFT JOIN JourneyPlan jp ON c.id = jp.clientId
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
      ${whereClause}
    `;
    const [countResult] = await db.query(countQuery, params);
    const totalOutlets = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalOutlets / itemsPerPage);

    // Per-outlet monthly visit counts
    const yearParams = Array(13).fill(currentYear); // 12 months + total
    const allParams = [...yearParams, ...params, itemsPerPage, offset];

    const [rows] = await db.query(
      `
      SELECT
        c.id AS outlet_id,
        c.name AS outlet_name,
        oa.name AS outlet_account_name,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 1 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS january,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 2 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS february,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 3 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS march,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 4 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS april,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 5 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS may,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 6 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS june,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 7 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS july,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 8 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS august,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 9 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS september,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 10 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS october,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 11 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS november,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 12 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS december,
        COALESCE(SUM(CASE WHEN YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS total
      FROM Clients c
      LEFT JOIN JourneyPlan jp ON c.id = jp.clientId
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
      ${whereClause}
      GROUP BY c.id, c.name
      ORDER BY c.name
      LIMIT ? OFFSET ?
    `,
      allParams,
    );

    // Totals across all outlets (not just current page)
    const totalsYearParams = Array(13).fill(currentYear);
    const totalsParams = [...totalsYearParams, ...params];
    const [totalsResult] = await db.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 1 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS january,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 2 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS february,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 3 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS march,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 4 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS april,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 5 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS may,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 6 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS june,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 7 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS july,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 8 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS august,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 9 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS september,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 10 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS october,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 11 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS november,
        COALESCE(SUM(CASE WHEN MONTH(jp.checkInTime) = 12 AND YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS december,
        COALESCE(SUM(CASE WHEN YEAR(jp.checkInTime) = ? THEN 1 ELSE 0 END), 0) AS total
      FROM Clients c
      LEFT JOIN JourneyPlan jp ON c.id = jp.clientId
      LEFT JOIN outlet_accounts oa ON c.outlet_account = oa.id
      ${whereClause}
    `,
      totalsParams,
    );

    const totals =
      totalsResult[0] || {
        january: 0,
        february: 0,
        march: 0,
        april: 0,
        may: 0,
        june: 0,
        july: 0,
        august: 0,
        september: 0,
        october: 0,
        november: 0,
        december: 0,
        total: 0,
      };

    res.json({
      success: true,
      data: rows,
      totals,
      pagination: {
        currentPage,
        itemsPerPage,
        totalItems: totalOutlets,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
    });
  } catch (err) {
    console.error('Error fetching outlet visits summary:', err);
    res
      .status(500)
      .json({ error: 'Failed to fetch outlet visits summary', details: err.message });
  }
};

// Get available categories for master sales filter
exports.getMasterSalesCategories = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DISTINCT cat.id, cat.name
      FROM Category cat
      JOIN products p ON cat.id = p.category_id
      JOIN sales_order_items soi ON p.id = soi.product_id
      JOIN sales_orders so ON soi.sales_order_id = so.id
      WHERE so.my_status = 1
      ORDER BY cat.name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories', details: err.message });
  }
};

// Get detailed sales data for a specific client and month
exports.getClientMonthDetails = async (req, res) => {
  try {
    const { clientId, month, year } = req.query;
    
    console.log('[getClientMonthDetails] Request params:', { clientId, month, year });
    
    if (!clientId || !month || !year) {
      console.log('[getClientMonthDetails] Missing required params');
      return res.status(400).json({ error: 'Client ID, month, and year are required' });
    }

    const queryParams = [clientId, month, year];
    console.log('[getClientMonthDetails] Executing query with params:', queryParams);
    
    const query = `
      SELECT 
        so.id as order_id,
        so.order_date,
        so.id as order_number,
        so.total_amount as order_total,
        so.status as order_status,
        so.created_at as order_created_at,
        c.name as client_name,
        c.contact as client_phone,
        c.email as client_email,
        p.product_name,
        soi.quantity,
        soi.unit_price,
        (soi.quantity * soi.unit_price) as line_total,
        cat.name as category_name,
        sr.name as sales_rep_name
      FROM sales_orders so
      JOIN Clients c ON so.client_id = c.id
      JOIN sales_order_items soi ON so.id = soi.sales_order_id
      JOIN products p ON soi.product_id = p.id
      LEFT JOIN Category cat ON p.category_id = cat.id
      LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
      WHERE so.client_id = ? 
        AND MONTH(so.order_date) = ? 
        AND YEAR(so.order_date) = ?
        AND so.my_status IN (1, 2, 3, 7)
      ORDER BY so.order_date DESC, so.id DESC, p.product_name
    `;
    
    const [rows] = await db.query(query, queryParams);

    console.log('[getClientMonthDetails] Found', rows.length, 'records');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching client month details:', err);
    res.status(500).json({ error: 'Failed to fetch client month details', details: err.message });
  }
};

// Get detailed sales data for a specific client for the entire year
exports.getClientYearDetails = async (req, res) => {
  try {
    const { clientId, year } = req.query;
    
    console.log('[getClientYearDetails] Request params:', { clientId, year });
    
    if (!clientId || !year) {
      console.log('[getClientYearDetails] Missing required params');
      return res.status(400).json({ error: 'Client ID and year are required' });
    }

    const queryParams = [clientId, year];
    console.log('[getClientYearDetails] Executing query with params:', queryParams);
    
    const query = `
      SELECT 
        so.id as order_id,
        so.order_date,
        so.id as order_number,
        so.total_amount as order_total,
        so.status as order_status,
        so.created_at as order_created_at,
        c.name as client_name,
        c.contact as client_phone,
        c.email as client_email,
        p.product_name,
        soi.quantity,
        soi.unit_price,
        (soi.quantity * soi.unit_price) as line_total,
        cat.name as category_name,
        sr.name as sales_rep_name,
        MONTHNAME(so.order_date) as month_name
      FROM sales_orders so
      JOIN Clients c ON so.client_id = c.id
      JOIN sales_order_items soi ON so.id = soi.sales_order_id
      JOIN products p ON soi.product_id = p.id
      LEFT JOIN Category cat ON p.category_id = cat.id
      LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
      WHERE so.client_id = ? 
        AND YEAR(so.order_date) = ?
        AND so.my_status IN (1, 2, 3, 7)
      ORDER BY so.order_date DESC, so.id DESC, p.product_name
    `;
    
    const [rows] = await db.query(query, queryParams);

    console.log('[getClientYearDetails] Found', rows.length, 'records');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching client year details:', err);
    res.status(500).json({ error: 'Failed to fetch client year details', details: err.message });
  }
};

// Get available sales reps for master sales filter
exports.getMasterSalesSalesReps = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DISTINCT sr.id, sr.name
      FROM SalesRep sr
      JOIN Clients c ON sr.route_id_update = c.route_id_update
      JOIN sales_orders so ON c.id = so.client_id
      WHERE so.my_status = 1
      ORDER BY sr.name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sales reps:', err);
    res.status(500).json({ error: 'Failed to fetch sales reps', details: err.message });
  }
};

// Get sales rep master report
exports.getSalesRepMasterReport = async (req, res) => {
  try {
    console.log('Fetching sales rep master report with params:', req.query);
    
    const { start_date, end_date, status, country } = req.query;
    
    // Build date filter conditions
    let dateFilter = '';
    const params = [];
    
    if (start_date && end_date) {
      dateFilter = 'AND DATE(jp.checkInTime) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      dateFilter = 'AND DATE(jp.checkInTime) >= ?';
      params.push(start_date);
    } else if (end_date) {
      dateFilter = 'AND DATE(jp.checkInTime) <= ?';
      params.push(end_date);
    }

    // Build filters for SalesRep
    const filters = [];
    if (status) {
      filters.push('sr.status = ?');
      params.push(parseInt(status));
    }
    if (country) {
      filters.push('sr.country = ?');
      params.push(country);
    }
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    console.log('Date filter:', dateFilter);
    console.log('Where clause:', whereClause);
    console.log('Query params:', params);

    const query = `
      SELECT 
        sr.id,
        sr.name,
        sr.status,
        sr.country,
        COALESCE(COUNT(DISTINCT jp.id), 0) as total_journeys,
        COALESCE(COUNT(DISTINCT CASE WHEN jp.status = 'completed' THEN jp.id END), 0) as completed_journeys,
        CASE 
          WHEN COALESCE(COUNT(DISTINCT CASE WHEN jp.status = '3' THEN jp.id END), 0) >= 7 THEN 100
          WHEN COALESCE(COUNT(DISTINCT jp.id), 0) > 0 
          THEN ROUND((COALESCE(COUNT(DISTINCT CASE WHEN jp.status = '3' THEN jp.id END), 0) / 7) * 100, 1)
          ELSE 0 
        END as completion_rate
      FROM SalesRep sr
      LEFT JOIN JourneyPlan jp ON sr.id = jp.userId 
        ${dateFilter ? dateFilter : ''}
      ${whereClause}
      GROUP BY sr.id, sr.name, sr.status, sr.country
      ORDER BY sr.name
    `;

    console.log('Executing query:', query);
    const [rows] = await db.query(query, params);
    console.log('Query result:', rows);
    
    // Debug: Check if we have any data
    if (rows.length === 0) {
      console.log('No sales rep data found. Checking if SalesRep table has data...');
      const [salesReps] = await db.query('SELECT COUNT(*) as count FROM SalesRep');
      console.log('SalesRep count:', salesReps[0].count);
      
      if (date) {
        console.log('Checking JourneyPlan data for date:', date);
        const [journeyData] = await db.query('SELECT COUNT(*) as count FROM JourneyPlan WHERE DATE(checkInTime) = ?', [date]);
        console.log('JourneyPlan count for date:', journeyData[0].count);
        
        // Test query without date filter
        console.log('Testing query without date filter...');
        const [testRows] = await db.query(`
          SELECT 
            sr.id,
            sr.name,
            COALESCE(COUNT(DISTINCT jp.id), 0) as total_journeys,
            COALESCE(COUNT(DISTINCT CASE WHEN jp.status = 'completed' THEN jp.id END), 0) as completed_journeys
          FROM SalesRep sr
          LEFT JOIN JourneyPlan jp ON sr.id = jp.userId 
          GROUP BY sr.id, sr.name
          ORDER BY sr.name
          LIMIT 5
        `);
        console.log('Test query result (first 5):', testRows);
      }
    }

    res.json(rows);
  } catch (err) {
    console.error('Error fetching sales rep master report:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    res.status(500).json({ error: 'Failed to fetch sales rep master report', details: err.message });
  }
};

// Get journey details for a sales rep
exports.getJourneyDetails = async (req, res) => {
  try {
    console.log('Fetching journey details with params:', req.query);
    
    const { salesRepId, start_date, end_date } = req.query;
    
    if (!salesRepId) {
      return res.status(400).json({ error: 'Sales rep ID is required' });
    }

    let dateFilter = '';
    const params = [salesRepId];
    
    if (start_date && end_date) {
      dateFilter = 'AND DATE(jp.checkInTime) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      dateFilter = 'AND DATE(jp.checkInTime) >= ?';
      params.push(start_date);
    } else if (end_date) {
      dateFilter = 'AND DATE(jp.checkInTime) <= ?';
      params.push(end_date);
    }

    console.log('Date filter:', dateFilter);
    console.log('Query params:', params);

    const query = `
      SELECT 
        jp.id,
        jp.checkInTime,
        jp.checkOutTime,
        jp.status,
        c.name as outlet_name,
        c.id as client_id
      FROM JourneyPlan jp
      LEFT JOIN Clients c ON jp.clientId = c.id
      WHERE jp.userId = ? 
        ${dateFilter}
      ORDER BY jp.checkInTime ASC
    `;

    console.log('Executing journey details query:', query);
    const [rows] = await db.query(query, params);
    console.log('Journey details result:', rows);

    // Debug: Check if we have any data
    if (rows.length === 0) {
      console.log('No journey details found. Running debug queries...');
      
      // Check if sales rep exists
      const [salesRepCheck] = await db.query('SELECT id, name FROM SalesRep WHERE id = ?', [salesRepId]);
      console.log('Sales rep check:', salesRepCheck);
      
      // Check total journey plans for this sales rep (no date filter)
      const [totalJourneys] = await db.query('SELECT COUNT(*) as count FROM JourneyPlan WHERE userId = ?', [salesRepId]);
      console.log('Total journeys for sales rep:', totalJourneys[0].count);
      
      // Check journey plans for the specific date
      if (date) {
        const [dateJourneys] = await db.query('SELECT COUNT(*) as count FROM JourneyPlan WHERE userId = ? AND DATE(checkInTime) = ?', [salesRepId, date]);
        console.log('Journeys for date', date, ':', dateJourneys[0].count);
        
        // Check what dates are available for this sales rep
        const [availableDates] = await db.query('SELECT DISTINCT DATE(checkInTime) as date FROM JourneyPlan WHERE userId = ? ORDER BY date DESC LIMIT 5', [salesRepId]);
        console.log('Available dates for sales rep:', availableDates);
        
        // Try without date filter to see if we get any data
        console.log('Trying query without date filter...');
        const [fallbackRows] = await db.query(`
          SELECT 
            jp.id,
            jp.checkInTime,
            jp.checkOutTime,
            jp.status,
            c.name as outlet_name,
            c.id as client_id
          FROM JourneyPlan jp
          LEFT JOIN Clients c ON jp.clientId = c.id
          WHERE jp.userId = ?
          ORDER BY jp.checkInTime ASC
          LIMIT 50
        `, [salesRepId]);
        console.log('Fallback query result (first 5):', fallbackRows);
      }
      
      // Check if there are any journey plans at all
      const [allJourneys] = await db.query('SELECT COUNT(*) as count FROM JourneyPlan');
      console.log('Total journey plans in database:', allJourneys[0].count);
      
            // Check sample journey plan data
      const [sampleJourney] = await db.query('SELECT * FROM JourneyPlan LIMIT 1');
      console.log('Sample journey plan:', sampleJourney[0]);
    }

    res.json(rows);
  } catch (err) {
    console.error('Error fetching journey details:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    res.status(500).json({ error: 'Failed to fetch journey details', details: err.message });
  }
};

// Get outlet visit details (rows from JourneyPlan) for a specific outlet
exports.getOutletVisitDetails = async (req, res) => {
  try {
    const { outletId, year, startDate, endDate } = req.query;

    if (!outletId) {
      return res.status(400).json({ success: false, error: 'outletId is required' });
    }

    const params = [outletId];
    const conditions = ['jp.clientId = ?'];

    if (startDate) {
      conditions.push('DATE(jp.checkInTime) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(jp.checkInTime) <= ?');
      params.push(endDate);
    }

    if (year && !startDate && !endDate) {
      conditions.push('YEAR(jp.checkInTime) = ?');
      params.push(parseInt(year, 10));
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        jp.id,
        DATE(jp.checkInTime) AS visit_date,
        jp.checkInTime,
        jp.checkOutTime,
        sr.name AS sales_rep_name,
        COALESCE(
          TIMESTAMPDIFF(
            MINUTE,
            jp.checkInTime,
            jp.checkOutTime
          ),
          0
        ) AS time_spent_minutes
      FROM JourneyPlan jp
      LEFT JOIN SalesRep sr ON jp.userId = sr.id
      ${whereClause}
      ORDER BY jp.checkInTime ASC
    `;

    const [rows] = await db.query(query, params);

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error('Error fetching outlet visit details:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch outlet visit details',
      details: err.message,
    });
  }
};

// Get reports for a sales rep and client
exports.getSalesRepReports = async (req, res) => {
  try {
    console.log('Fetching sales rep reports with params:', req.query);
    
    const { salesRepId, clientId, date } = req.query;
    
    if (!salesRepId || !clientId) {
      return res.status(400).json({ error: 'Sales rep ID and client ID are required' });
    }

    let dateFilter = '';
    const params = [salesRepId, clientId];
    
    if (date) {
      dateFilter = 'AND DATE(createdAt) = ?';
      params.push(date);
    }

    console.log('Date filter:', dateFilter);
    console.log('Query params:', params);

    // Get visibility reports
    const visibilityQuery = `
      SELECT 
        id,
        'visibility' as report_type,
        createdAt,
        comment as notes,
        imageUrl
      FROM VisibilityReport 
      WHERE userId = ? AND clientId = ? 
        ${dateFilter}
      ORDER BY createdAt DESC
    `;

    // Get feedback reports
    const feedbackQuery = `
      SELECT 
        id,
        'feedback' as report_type,
        createdAt,
        comment as notes
      FROM FeedbackReport 
      WHERE userId = ? AND clientId = ? 
        ${dateFilter}
      ORDER BY createdAt DESC
    `;

    console.log('Executing visibility reports query:', visibilityQuery);
    const [visibilityReports] = await db.query(visibilityQuery, params);
    console.log('Visibility reports result:', visibilityReports);

    console.log('Executing feedback reports query:', feedbackQuery);
    const [feedbackReports] = await db.query(feedbackQuery, params);
    console.log('Feedback reports result:', feedbackReports);

    // Combine and sort all reports by creation date
    const allReports = [...visibilityReports, ...feedbackReports].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      visibility_reports: visibilityReports,
      feedback_reports: feedbackReports,
      all_reports: allReports
    });
  } catch (err) {
    console.error('Error fetching sales rep reports:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage
    });
    res.status(500).json({ error: 'Failed to fetch sales rep reports', details: err.message });
  }
};

// Get sales rep monthly performance data
exports.getSalesRepMonthlyPerformance = async (req, res) => {
  try {
    console.log('[getSalesRepMonthlyPerformance] ===== START =====');
    console.log('[getSalesRepMonthlyPerformance] Full request query:', JSON.stringify(req.query, null, 2));
    
    const { year, salesRep, startDate, endDate, viewType, country } = req.query;
    const currentYear = year || new Date().getFullYear();
    const isQuantityView = viewType === 'quantity';
    
    // Parse salesRep as array
    const salesReps = salesRep ? (Array.isArray(salesRep) ? salesRep : [salesRep]) : [];

    // Get countryId from Country table based on country name
    let countryId = null;
    let countryName = null;
    if (country && country.trim() !== '') {
      countryName = country.trim();
      try {
        // First, check what countries are in the Country table
        const [allCountries] = await db.query('SELECT id, name FROM Country ORDER BY name');
        console.log('[getSalesRepMonthlyPerformance] Available countries in Country table:', allCountries);
        
        // Look up countryId from Country table by name
        const [countryRows] = await db.query(
          'SELECT id FROM Country WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
          [countryName]
        );
        
        if (countryRows.length > 0) {
          countryId = countryRows[0].id;
          console.log('[getSalesRepMonthlyPerformance] ✓ Found countryId:', countryId, 'for country:', countryName);
        } else {
          console.log('[getSalesRepMonthlyPerformance] ✗ Country not found in Country table:', countryName);
          console.log('[getSalesRepMonthlyPerformance] Trying fallback mapping...');
          // Fallback: try manual mapping
          const countryNameLower = countryName.toLowerCase();
          if (countryNameLower === 'kenya') {
            countryId = 1;
          } else if (countryNameLower === 'tanzania') {
            countryId = 2;
          }
          console.log('[getSalesRepMonthlyPerformance] Fallback countryId:', countryId);
        }
      } catch (countryErr) {
        console.error('[getSalesRepMonthlyPerformance] ✗ Error looking up country:', countryErr);
        console.error('[getSalesRepMonthlyPerformance] Error details:', countryErr.message);
        // Fallback: try manual mapping
        const countryNameLower = countryName.toLowerCase();
        if (countryNameLower === 'kenya') {
          countryId = 1;
        } else if (countryNameLower === 'tanzania') {
          countryId = 2;
        }
        console.log('[getSalesRepMonthlyPerformance] Fallback countryId after error:', countryId);
      }
    }

    console.log('[getSalesRepMonthlyPerformance] Parsed params:', {
      year: currentYear,
      salesRep,
      salesReps: salesReps,
      startDate,
      endDate,
      viewType,
      isQuantityView,
      country: country,
      countryName: countryName,
      countryId: countryId,
      countryIdMapped: countryId !== null
    });

    // Get all sales reps with their monthly sales data using salesrep from sales_orders
    // IMPORTANT: LEFT JOIN ensures sales reps are returned even if they have no orders
    let rows;
    try {
      console.log('[getSalesRepMonthlyPerformance] ===== EXECUTING MAIN QUERY =====');
      console.log('[getSalesRepMonthlyPerformance] Year filter:', currentYear);
      console.log('[getSalesRepMonthlyPerformance] Country filter status:', {
        country: country,
        countryName: countryName,
        countryId: countryId,
        willFilter: countryId !== null
      });
      
      const queryString = `
      SELECT 
        sr.id as sales_rep_id,
        sr.name as sales_rep_name,
        sr.countryId as countryId,
        COALESCE(c.name, CASE WHEN sr.countryId = 1 THEN 'Kenya' WHEN sr.countryId = 2 THEN 'Tanzania' ELSE NULL END) as country,
        ${isQuantityView ? `
        -- Vapes quantities (categories 1, 3)
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 1 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as january_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 2 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as february_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 3 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as march_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 4 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as april_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 5 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as may_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 6 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as june_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 7 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as july_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 8 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as august_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 9 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as september_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 10 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as october_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 11 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as november_vapes,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 12 AND YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as december_vapes,
        COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) as total_vapes,
        -- Pouches quantities (categories 4, 5)
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 1 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as january_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 2 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as february_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 3 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as march_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 4 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as april_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 5 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as may_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 6 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as june_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 7 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as july_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 8 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as august_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 9 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as september_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 10 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as october_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 11 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as november_pouches,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 12 AND YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as december_pouches,
        COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0) as total_pouches
        ` : `
        -- Sales values
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 1 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as january,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 2 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as february,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 3 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as march,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 4 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as april,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 5 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as may,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 6 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as june,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 7 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as july,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 8 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as august,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 9 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as september,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 10 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as october,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 11 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as november,
        COALESCE(SUM(CASE WHEN MONTH(so.order_date) = 12 AND YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as december,
        COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0) as total
        `}
      FROM SalesRep sr
      LEFT JOIN Country c ON sr.countryId = c.id
      LEFT JOIN sales_orders so ON (
        (sr.id = so.salesrep OR sr.id = CAST(so.salesrep AS UNSIGNED)) 
        AND so.my_status IN (1, 2, 3, 7)
      )
      LEFT JOIN sales_order_items soi ON so.id = soi.sales_order_id
      LEFT JOIN products p ON soi.product_id = p.id
      WHERE sr.status = 1
      ${(() => {
        const conditions = [];
        if (countryId !== null) {
          console.log('[getSalesRepMonthlyPerformance] Applying country filter by countryId:', countryId);
          conditions.push('sr.countryId = ?');
        }
        if (salesReps.length > 0) {
          conditions.push('sr.id IN (' + salesReps.map(() => '?').join(',') + ')');
        }
        if (startDate) {
          conditions.push('(so.order_date >= ? OR so.order_date IS NULL)');
        }
        if (endDate) {
          conditions.push('(so.order_date <= ? OR so.order_date IS NULL)');
        }
        const whereClause = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';
        console.log('[getSalesRepMonthlyPerformance] ===== WHERE CLAUSE CONSTRUCTION =====');
        console.log('[getSalesRepMonthlyPerformance] Conditions array:', conditions);
        console.log('[getSalesRepMonthlyPerformance] Final WHERE clause:', whereClause);
        if (countryId !== null) {
          console.log('[getSalesRepMonthlyPerformance] Country filter IS applied');
          console.log('[getSalesRepMonthlyPerformance] Country filter countryId:', countryId);
        } else {
          console.log('[getSalesRepMonthlyPerformance] Country filter NOT applied');
        }
        return whereClause;
      })()}
      GROUP BY sr.id, sr.name, sr.countryId
      ORDER BY ${isQuantityView ? 
        '(COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? AND p.category_id IN (1, 3) THEN soi.quantity ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? AND p.category_id IN (4, 5) THEN soi.quantity ELSE 0 END), 0))' : 
        'COALESCE(SUM(CASE WHEN YEAR(so.order_date) = ? THEN soi.quantity * soi.unit_price ELSE 0 END), 0)'
      } DESC, sr.name
    `;
      
      const params = (() => {
      let params;
      if (isQuantityView) {
        // For quantity view: 12 months for vapes + 1 total for vapes + 12 months for pouches + 1 total for pouches + 2 for ORDER BY = 28 parameters
        params = [
          currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, 
          currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, // vapes months + total
          currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, 
          currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, // pouches months + total
          currentYear, currentYear // ORDER BY vapes and pouches totals
        ];
      } else {
        // For sales view: 12 months + 1 total + 1 for ORDER BY = 14 parameters
        params = [currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, 
          currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, currentYear, // months + total
          currentYear // ORDER BY total
        ];
      }
      if (countryId !== null) {
        console.log('[getSalesRepMonthlyPerformance] Adding countryId param:', countryId);
        params.push(countryId);
      }
      if (salesReps.length > 0) params.push(...salesReps);
      if (startDate) params.push(startDate);
      if (endDate) params.push(endDate);
      console.log('[getSalesRepMonthlyPerformance] Final params array (length:', params.length, '):', params);
      console.log('[getSalesRepMonthlyPerformance] Parameter breakdown:', {
        countryIdInParams: countryId !== null,
        countryIdValue: countryId,
        salesRepsCount: salesReps.length,
        hasStartDate: !!startDate,
        hasEndDate: !!endDate,
        totalParams: params.length
      });
      return params;
    })();

      console.log('[getSalesRepMonthlyPerformance] About to execute query with', params.length, 'parameters');
      
      // Test: Run a simpler query first to verify country filter works
      if (countryId !== null) {
        const [testCountryFilter] = await db.query(
          'SELECT COUNT(*) as count FROM SalesRep WHERE status = 1 AND countryId = ?',
          [countryId]
        );
        console.log('[getSalesRepMonthlyPerformance] TEST: Sales reps with countryId', countryId, ':', testCountryFilter[0].count);
        
        if (testCountryFilter[0].count === 0) {
          console.log('[getSalesRepMonthlyPerformance] ⚠️ WARNING: No sales reps found with countryId:', countryId);
          console.log('[getSalesRepMonthlyPerformance] Checking all countryId values in SalesRep table...');
          const [allCountryIds] = await db.query(
            'SELECT DISTINCT countryId, COUNT(*) as count FROM SalesRep WHERE status = 1 GROUP BY countryId'
          );
          console.log('[getSalesRepMonthlyPerformance] All countryId values:', allCountryIds);
        }
      }
      
      const [queryRows] = await db.query(queryString, params);

      rows = queryRows;
      console.log('[getSalesRepMonthlyPerformance] ===== QUERY RESULTS =====');
      console.log('[getSalesRepMonthlyPerformance] Raw query rows returned:', rows.length);
      
      if (countryId !== null && rows.length > 0) {
        console.log('[getSalesRepMonthlyPerformance] Sample countryId from results:', rows.slice(0, 3).map(r => ({ name: r.sales_rep_name, countryId: r.countryId })));
      }
      
      if (rows.length === 0) {
        console.log('[getSalesRepMonthlyPerformance] ⚠️ WARNING: Query returned 0 rows but diagnostic shows matching data');
        
        // Test 1: Get sales reps without any JOINs
        const [testSalesReps] = await db.query(
          'SELECT id, name, countryId FROM SalesRep WHERE status = 1',
          []
        );
        console.log('[getSalesRepMonthlyPerformance] Test 1 - Sales reps matching filter:', testSalesReps.length);
        if (testSalesReps.length > 0 && testSalesReps.length <= 10) {
          console.log('[getSalesRepMonthlyPerformance] First 3 sales reps:', testSalesReps.slice(0, 3));
        }
        
        // Test 2: Check if we can get sales reps with LEFT JOIN (simplified query)
        if (testSalesReps.length > 0) {
          const testId = testSalesReps[0].id;
          const [testJoin] = await db.query(`
            SELECT sr.id, sr.name, sr.countryId, COUNT(so.id) as order_count
            FROM SalesRep sr
            LEFT JOIN sales_orders so ON (sr.id = so.salesrep OR sr.id = CAST(so.salesrep AS UNSIGNED)) 
              AND so.my_status IN (1, 2, 3, 7)
            WHERE sr.status = 1
            GROUP BY sr.id, sr.name, sr.countryId
            LIMIT 5
          `, []);
          console.log('[getSalesRepMonthlyPerformance] Test 2 - Simple LEFT JOIN query returned:', testJoin.length, 'rows');
          if (testJoin.length > 0) {
            console.log('[getSalesRepMonthlyPerformance] Test 2 results:', testJoin);
          }
        }
        
        // Test 3: Check actual salesrep column values in orders
        if (testSalesReps.length > 0) {
          const salesRepIds = testSalesReps.slice(0, 5).map(r => r.id);
          const [testOrders] = await db.query(`
            SELECT DISTINCT so.salesrep, 
                   CAST(so.salesrep AS UNSIGNED) as salesrep_int,
                   COUNT(*) as order_count
            FROM sales_orders so 
            WHERE so.my_status IN (1, 2, 3, 7) 
              AND YEAR(so.order_date) = ?
            GROUP BY so.salesrep
            LIMIT 10
          `, [currentYear]);
          console.log('[getSalesRepMonthlyPerformance] Test 3 - Actual salesrep values in orders for year', currentYear, ':', testOrders.length, 'unique values');
          if (testOrders.length > 0) {
            console.log('[getSalesRepMonthlyPerformance] Test 3 sample:', testOrders);
            console.log('[getSalesRepMonthlyPerformance] Sales rep IDs from filter:', salesRepIds);
            console.log('[getSalesRepMonthlyPerformance] Do any salesrep values match?', testOrders.some(o => salesRepIds.includes(o.salesrep_int)));
          }
        }
      }
      
      console.log('[getSalesRepMonthlyPerformance] Final rows count:', rows.length);
      
      if (rows.length > 0) {
        console.log('[getSalesRepMonthlyPerformance] First 3 rows sample:', rows.slice(0, 3).map(row => ({
          sales_rep_id: row.sales_rep_id,
          sales_rep_name: row.sales_rep_name,
          countryId: row.countryId || 'NULL/UNDEFINED',
          total: row.total || row.total_vapes || 'N/A'
        })));
        
        // Check unique countryIds in results
        const uniqueCountryIds = [...new Set(rows.map(r => r.countryId).filter(c => c !== null && c !== undefined))];
        console.log('[getSalesRepMonthlyPerformance] Unique countryIds in results:', uniqueCountryIds);
        console.log('[getSalesRepMonthlyPerformance] Total unique countryIds:', uniqueCountryIds.length);
      } else {
        console.log('[getSalesRepMonthlyPerformance] ⚠️ No rows returned. Running diagnostic queries...');
        
        // Debug query 1: Check all sales reps
        const [allSalesRepsCheck] = await db.query('SELECT COUNT(*) as count FROM SalesRep WHERE status = 1', []);
        console.log('[getSalesRepMonthlyPerformance] Total active sales reps:', allSalesRepsCheck[0].count);
        
        
        // Debug query 3: Check if there are any sales orders
        const [salesOrdersCheck] = await db.query('SELECT COUNT(*) as count FROM sales_orders WHERE my_status IN (1, 2, 3, 7) AND YEAR(order_date) = ?', [currentYear]);
        console.log('[getSalesRepMonthlyPerformance] Sales orders count for year', currentYear, ':', salesOrdersCheck[0].count);
      }
    } catch (queryErr) {
      console.error('Main query error:', queryErr.message);
      console.error('Query parameters:', {
        year: currentYear,
        viewType,
        isQuantityView,
        salesReps,
        startDate,
        endDate,
        country
      });
      throw queryErr;
    }

    // Fetch targets separately to avoid row multiplication
    try {
      const salesRepIds = rows.map(row => row.sales_rep_id);
      if (salesRepIds.length > 0) {
        const placeholders = salesRepIds.map(() => '?').join(',');
        const [targets] = await db.query(`
          SELECT 
            sales_rep_id,
            month,
            vapes_target,
            pouches_target
          FROM sales_rep_targets
          WHERE sales_rep_id IN (${placeholders}) AND year = ?
        `, [...salesRepIds, currentYear]);

        // Merge targets into rows
        rows.forEach(row => {
          const repTargets = targets.filter(t => t.sales_rep_id === row.sales_rep_id);
          
          // Initialize all target fields to 0
          for (let i = 1; i <= 12; i++) {
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                               'july', 'august', 'september', 'october', 'november', 'december'];
            row[`${monthNames[i-1]}_vapes_target`] = 0;
            row[`${monthNames[i-1]}_pouches_target`] = 0;
          }
          
          // Fill in actual target values
          repTargets.forEach(target => {
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                               'july', 'august', 'september', 'october', 'november', 'december'];
            const monthName = monthNames[target.month - 1];
            row[`${monthName}_vapes_target`] = target.vapes_target || 0;
            row[`${monthName}_pouches_target`] = target.pouches_target || 0;
          });
        });
      }
    } catch (targetsErr) {
      console.error('Error fetching targets:', targetsErr.message);
      // Continue without targets - they're optional
    }

    console.log('[getSalesRepMonthlyPerformance] ===== SUCCESS =====');
    console.log('[getSalesRepMonthlyPerformance] Returning', rows.length, 'rows');
    res.json(rows);
  } catch (err) {
    console.error('[getSalesRepMonthlyPerformance] ===== ERROR =====');
    console.error('[getSalesRepMonthlyPerformance] Error fetching sales rep monthly performance:', err);
    console.error('[getSalesRepMonthlyPerformance] Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to fetch sales rep monthly performance', details: err.message });
  }
};