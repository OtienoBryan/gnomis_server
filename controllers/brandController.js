const db = require('../database/db');

/**
 * Get all product brands
 */
exports.getAllBrands = async (req, res) => {
  try {
    const { active_only } = req.query;
    
    let sql = `
      SELECT 
        id, 
        name, 
        description, 
        is_active,
        created_at,
        updated_at
      FROM Brand
    `;
    
    if (active_only === 'true') {
      sql += ' WHERE is_active = TRUE';
    }
    
    sql += ' ORDER BY name ASC';
    
    const [brands] = await db.query(sql);
    
    res.json({
      success: true,
      data: brands,
      total: brands.length
    });
  } catch (err) {
    console.error('Error fetching brands:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch brands',
      details: err.message 
    });
  }
};

/**
 * Get a single brand by ID
 */
exports.getBrandById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [brands] = await db.query(
      'SELECT * FROM Brand WHERE id = ?',
      [id]
    );
    
    if (brands.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }
    
    res.json({
      success: true,
      data: brands[0]
    });
  } catch (err) {
    console.error('Error fetching brand:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch brand',
      details: err.message 
    });
  }
};

/**
 * Create a new brand
 */
exports.createBrand = async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Brand name is required'
      });
    }
    
    const [result] = await db.query(
      `INSERT INTO Brand (name, description, is_active) 
       VALUES (?, ?, ?)`,
      [name, description || null, is_active !== false]
    );
    
    const [newBrand] = await db.query(
      'SELECT * FROM Brand WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      data: newBrand[0]
    });
  } catch (err) {
    console.error('Error creating brand:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Brand with this name already exists'
      });
    }
    
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        error: 'Brand table does not exist. Please create the table first.'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create brand',
      details: err.message 
    });
  }
};

/**
 * Update a brand
 */
exports.updateBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }
    
    params.push(id);
    
    const [result] = await db.query(
      `UPDATE Brand SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }
    
    const [updatedBrand] = await db.query(
      'SELECT * FROM Brand WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      message: 'Brand updated successfully',
      data: updatedBrand[0]
    });
  } catch (err) {
    console.error('Error updating brand:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Brand with this name already exists'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update brand',
      details: err.message 
    });
  }
};

/**
 * Delete a brand (soft delete by setting is_active to false)
 */
exports.deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if brand has products
    const [products] = await db.query(
      'SELECT COUNT(*) as count FROM products WHERE brand_id = ?',
      [id]
    );
    
    if (products[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete brand. It has ${products[0].count} products assigned to it.`
      });
    }
    
    // Soft delete
    const [result] = await db.query(
      'UPDATE Brand SET is_active = FALSE WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Brand deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting brand:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete brand',
      details: err.message 
    });
  }
};
