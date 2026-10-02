const express = require('express');
const router = express.Router();
const db = require('../database/db'); // Adjust path if needed
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all rider routes
router.use(authenticateToken);

// Fixed bcrypt hash used as the default login password for every newly created driver
const DEFAULT_RIDER_PASSWORD_HASH = '$2a$10$me0dzhAfGglEGPhcK/34BuWmhYW3USYy3SeMbe46CQop102Yq./1S';

// GET /api/riders - fetch all drivers (SalesRep rows with role = 'driver')
router.get('/', async (req, res) => {
  console.log('GET /api/riders called');
  const sql = `
    SELECT id, name, phoneNumber as contact, id_number
    FROM SalesRep
    WHERE role = 'driver'
  `;
  console.log('SQL Query:', sql);
  try {
    const [rows] = await db.query(sql);
    console.log('Riders fetched:', rows.length);
    res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching riders:', error);
    res.status(500).json({ error: 'Failed to fetch riders', details: error.message || error });
  }
});

// POST /api/riders - create new driver
router.post('/', async (req, res) => {
  console.log('POST /api/riders called', req.body);
  const { name, contact, id_number } = req.body;

  if (!name || !contact || !id_number) {
    return res.status(400).json({ error: 'Name, contact, and ID number are required' });
  }

  try {
    const [existing] = await db.query(
      "SELECT id, phoneNumber as contact, id_number FROM SalesRep WHERE role = 'driver' AND (phoneNumber = ? OR id_number = ?)",
      [contact, id_number]
    );
    if (existing.length > 0) {
      const dupContact = existing.some(r => r.contact === contact);
      const dupIdNumber = existing.some(r => r.id_number === id_number);
      const fields = [dupContact && 'phone number', dupIdNumber && 'ID number'].filter(Boolean).join(' and ');
      return res.status(409).json({ error: `A driver with this ${fields} already exists` });
    }

    const sql = "INSERT INTO SalesRep (name, phoneNumber, id_number, password, role) VALUES (?, ?, ?, ?, 'driver')";
    const [result] = await db.query(sql, [name, contact, id_number, DEFAULT_RIDER_PASSWORD_HASH]);
    console.log('Rider created with ID:', result.insertId);
    res.status(201).json({
      success: true,
      data: { id: result.insertId, name, contact, id_number },
      message: 'Rider created successfully'
    });
  } catch (error) {
    console.error('Error creating rider:', error);
    res.status(500).json({ error: 'Failed to create rider', details: error.message || error });
  }
});

// PUT /api/riders/:id - update driver
router.put('/:id', async (req, res) => {
  console.log('PUT /api/riders/:id called', req.params.id, req.body);
  const { id } = req.params;
  const { name, contact, id_number } = req.body;

  if (!name || !contact || !id_number) {
    return res.status(400).json({ error: 'Name, contact, and ID number are required' });
  }

  try {
    const [existing] = await db.query(
      "SELECT id, phoneNumber as contact, id_number FROM SalesRep WHERE role = 'driver' AND (phoneNumber = ? OR id_number = ?) AND id != ?",
      [contact, id_number, id]
    );
    if (existing.length > 0) {
      const dupContact = existing.some(r => r.contact === contact);
      const dupIdNumber = existing.some(r => r.id_number === id_number);
      const fields = [dupContact && 'phone number', dupIdNumber && 'ID number'].filter(Boolean).join(' and ');
      return res.status(409).json({ error: `A driver with this ${fields} already exists` });
    }

    const sql = "UPDATE SalesRep SET name = ?, phoneNumber = ?, id_number = ? WHERE id = ? AND role = 'driver'";
    const [result] = await db.query(sql, [name, contact, id_number, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    console.log('Rider updated:', id);
    res.json({
      success: true,
      data: { id: parseInt(id), name, contact, id_number },
      message: 'Rider updated successfully'
    });
  } catch (error) {
    console.error('Error updating rider:', error);
    res.status(500).json({ error: 'Failed to update rider', details: error.message || error });
  }
});

// DELETE /api/riders/:id - delete driver
router.delete('/:id', async (req, res) => {
  console.log('DELETE /api/riders/:id called', req.params.id);
  const { id } = req.params;

  try {
    const sql = "DELETE FROM SalesRep WHERE id = ? AND role = 'driver'";
    const [result] = await db.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    console.log('Rider deleted:', id);
    res.json({
      success: true,
      message: 'Rider deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting rider:', error);
    res.status(500).json({ error: 'Failed to delete rider', details: error.message || error });
  }
});

module.exports = router;
