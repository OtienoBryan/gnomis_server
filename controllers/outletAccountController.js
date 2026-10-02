const db = require('../database/db');

/**
 * Get all outlet accounts
 */
exports.getAllOutletAccounts = async (req, res) => {
  try {
    const { active_only } = req.query;
    
    let sql = `
      SELECT 
        id, 
        name,
        planogram_compliance
      FROM outlet_accounts
    `;
    
    sql += ' ORDER BY name ASC';
    
    const [accounts] = await db.query(sql);
    
    res.json({
      success: true,
      data: accounts,
      total: accounts.length
    });
  } catch (err) {
    console.error('Error fetching outlet accounts:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch outlet accounts',
      details: err.message 
    });
  }
};

/**
 * Get a single outlet account by ID
 */
exports.getOutletAccountById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [accounts] = await db.query(
      'SELECT * FROM outlet_accounts WHERE id = ?',
      [id]
    );
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Outlet account not found'
      });
    }
    
    res.json({
      success: true,
      data: accounts[0]
    });
  } catch (err) {
    console.error('Error fetching outlet account:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch outlet account',
      details: err.message 
    });
  }
};

/**
 * Create a new outlet account
 */
exports.createOutletAccount = async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Outlet account name is required'
      });
    }
    
    const [result] = await db.query(
      `INSERT INTO outlet_accounts (name) 
       VALUES (?)`,
      [name]
    );
    
    const [newAccount] = await db.query(
      'SELECT * FROM outlet_accounts WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      success: true,
      message: 'Outlet account created successfully',
      data: newAccount[0]
    });
  } catch (err) {
    console.error('Error creating outlet account:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Outlet account with this name already exists'
      });
    }
    
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        error: 'Outlet accounts table does not exist. Please create the table first.'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create outlet account',
      details: err.message 
    });
  }
};

/**
 * Update an outlet account
 */
exports.updateOutletAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, planogram_compliance } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    
    if (planogram_compliance !== undefined) {
      updates.push('planogram_compliance = ?');
      params.push(planogram_compliance);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }
    
    params.push(id);
    
    const [result] = await db.query(
      `UPDATE outlet_accounts SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Outlet account not found'
      });
    }
    
    const [updatedAccount] = await db.query(
      'SELECT * FROM outlet_accounts WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      message: 'Outlet account updated successfully',
      data: updatedAccount[0]
    });
  } catch (err) {
    console.error('Error updating outlet account:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Outlet account with this name already exists'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update outlet account',
      details: err.message 
    });
  }
};

/**
 * Delete an outlet account
 */
exports.deleteOutletAccount = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Hard delete
    const [result] = await db.query(
      'DELETE FROM outlet_accounts WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Outlet account not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Outlet account deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting outlet account:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete outlet account',
      details: err.message 
    });
  }
};
