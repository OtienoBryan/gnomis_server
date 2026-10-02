const db = require('../database/db');

/**
 * Helper function to ensure the brand_sos_targets table exists
 */
async function ensureTableExists() {
  try {
    // Check if table exists
    const [tables] = await db.query("SHOW TABLES LIKE 'brand_sos_targets'");
    
    if (tables.length === 0) {
      // Create the table
      await db.query(`
        CREATE TABLE IF NOT EXISTS brand_sos_targets (
          id INT PRIMARY KEY AUTO_INCREMENT,
          outlet_account_id INT NOT NULL,
          brand_id INT NOT NULL,
          target_percentage DECIMAL(5,2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_outlet_brand (outlet_account_id, brand_id),
          INDEX idx_outlet_account (outlet_account_id),
          INDEX idx_brand (brand_id)
        )
      `);
      
      // Add foreign key constraints if tables exist
      try {
        // Check if outlet_accounts table exists
        const [outletTables] = await db.query("SHOW TABLES LIKE 'outlet_accounts'");
        if (outletTables.length > 0) {
          await db.query(`
            ALTER TABLE brand_sos_targets
            ADD CONSTRAINT fk_bst_outlet_account 
            FOREIGN KEY (outlet_account_id) REFERENCES outlet_accounts(id) 
            ON DELETE CASCADE
          `);
        }
      } catch (fkErr) {
        // Foreign key might already exist or table doesn't exist, ignore
        if (!fkErr.message.includes('Duplicate foreign key') && !fkErr.message.includes('already exists')) {
          console.warn('Could not add outlet_accounts foreign key:', fkErr.message);
        }
      }
      
      try {
        // Check if Brand table exists
        const [brandTables] = await db.query("SHOW TABLES LIKE 'Brand'");
        if (brandTables.length > 0) {
          await db.query(`
            ALTER TABLE brand_sos_targets
            ADD CONSTRAINT fk_bst_brand 
            FOREIGN KEY (brand_id) REFERENCES Brand(id) 
            ON DELETE CASCADE
          `);
        }
      } catch (fkErr) {
        // Foreign key might already exist or table doesn't exist, ignore
        if (!fkErr.message.includes('Duplicate foreign key') && !fkErr.message.includes('already exists')) {
          console.warn('Could not add Brand foreign key:', fkErr.message);
        }
      }
      
      console.log('Brand SOS targets table created successfully');
    }
  } catch (err) {
    console.error('Error ensuring brand_sos_targets table exists:', err);
    // Don't throw - let the actual query fail if table doesn't exist
  }
}

/**
 * Get all brand SOS targets for an outlet account
 */
exports.getBrandSosTargetsByOutletAccount = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { outletAccountId } = req.params;
    
    const [targets] = await db.query(`
      SELECT 
        bst.id,
        bst.outlet_account_id,
        bst.brand_id,
        bst.target_percentage,
        b.name as brand_name
      FROM brand_sos_targets bst
      LEFT JOIN Brand b ON bst.brand_id = b.id
      WHERE bst.outlet_account_id = ?
      ORDER BY b.name ASC
    `, [outletAccountId]);
    
    res.json({
      success: true,
      data: targets
    });
  } catch (err) {
    console.error('Error fetching brand SOS targets:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch brand SOS targets',
      details: err.message 
    });
  }
};

/**
 * Create or update a brand SOS target
 */
exports.setBrandSosTarget = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { outlet_account_id, brand_id, target_percentage } = req.body;
    
    if (!outlet_account_id || !brand_id || target_percentage === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Outlet account ID, brand ID, and target percentage are required'
      });
    }
    
    if (target_percentage < 0 || target_percentage > 100) {
      return res.status(400).json({
        success: false,
        error: 'Target percentage must be between 0 and 100'
      });
    }
    
    // Check if target already exists
    const [existing] = await db.query(
      'SELECT id FROM brand_sos_targets WHERE outlet_account_id = ? AND brand_id = ?',
      [outlet_account_id, brand_id]
    );
    
    if (existing.length > 0) {
      // Update existing target
      const [result] = await db.query(
        'UPDATE brand_sos_targets SET target_percentage = ? WHERE id = ?',
        [target_percentage, existing[0].id]
      );
      
      const [updated] = await db.query(`
        SELECT 
          bst.id,
          bst.outlet_account_id,
          bst.brand_id,
          bst.target_percentage,
          b.name as brand_name
        FROM brand_sos_targets bst
        LEFT JOIN Brand b ON bst.brand_id = b.id
        WHERE bst.id = ?
      `, [existing[0].id]);
      
      res.json({
        success: true,
        message: 'Brand SOS target updated successfully',
        data: updated[0]
      });
    } else {
      // Create new target
      const [result] = await db.query(
        'INSERT INTO brand_sos_targets (outlet_account_id, brand_id, target_percentage) VALUES (?, ?, ?)',
        [outlet_account_id, brand_id, target_percentage]
      );
      
      const [newTarget] = await db.query(`
        SELECT 
          bst.id,
          bst.outlet_account_id,
          bst.brand_id,
          bst.target_percentage,
          b.name as brand_name
        FROM brand_sos_targets bst
        LEFT JOIN Brand b ON bst.brand_id = b.id
        WHERE bst.id = ?
      `, [result.insertId]);
      
      res.status(201).json({
        success: true,
        message: 'Brand SOS target created successfully',
        data: newTarget[0]
      });
    }
  } catch (err) {
    console.error('Error setting brand SOS target:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to set brand SOS target',
      details: err.message 
    });
  }
};

/**
 * Get all brand SOS targets (with optional filters)
 */
exports.getAllBrandSosTargets = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { outlet_account_id, brand_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let whereConditions = [];
    let queryParams = [];
    
    if (outlet_account_id) {
      whereConditions.push('bst.outlet_account_id = ?');
      queryParams.push(outlet_account_id);
    }
    
    if (brand_id) {
      whereConditions.push('bst.brand_id = ?');
      queryParams.push(brand_id);
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';
    
    // Get total count
    const [countResult] = await db.query(`
      SELECT COUNT(*) as total
      FROM brand_sos_targets bst
      ${whereClause}
    `, queryParams);
    const total = countResult[0].total;
    
    // Get paginated results
    queryParams.push(parseInt(limit), offset);
    const [targets] = await db.query(`
      SELECT 
        bst.id,
        bst.outlet_account_id,
        bst.brand_id,
        bst.target_percentage,
        bst.created_at,
        bst.updated_at,
        b.name as brand_name,
        oa.name as outlet_account_name
      FROM brand_sos_targets bst
      LEFT JOIN Brand b ON bst.brand_id = b.id
      LEFT JOIN outlet_accounts oa ON bst.outlet_account_id = oa.id
      ${whereClause}
      ORDER BY oa.name ASC, b.name ASC
      LIMIT ? OFFSET ?
    `, queryParams);
    
    res.json({
      success: true,
      data: targets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Error fetching all brand SOS targets:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch brand SOS targets',
      details: err.message 
    });
  }
};

/**
 * Delete a brand SOS target
 */
exports.deleteBrandSosTarget = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { id } = req.params;
    
    const [result] = await db.query(
      'DELETE FROM brand_sos_targets WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand SOS target not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Brand SOS target deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting brand SOS target:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete brand SOS target',
      details: err.message 
    });
  }
};
