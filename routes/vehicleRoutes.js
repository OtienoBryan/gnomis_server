const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/vehicles - fetch all vehicles
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, registration_number, model, consumption, status, created_at FROM delivery_vehicles ORDER BY created_at DESC'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles', details: error.message || error });
  }
});

// POST /api/vehicles - create new vehicle
router.post('/', async (req, res) => {
  const { registration_number, model, consumption } = req.body;

  if (!registration_number || !model) {
    return res.status(400).json({ error: 'Registration number and vehicle model are required' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM delivery_vehicles WHERE registration_number = ?',
      [registration_number]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A vehicle with this registration number already exists' });
    }

    const sql = 'INSERT INTO delivery_vehicles (registration_number, model, consumption) VALUES (?, ?, ?)';
    const [result] = await db.query(sql, [registration_number, model, consumption || null]);
    res.status(201).json({
      success: true,
      data: { id: result.insertId, registration_number, model, consumption },
      message: 'Vehicle created successfully'
    });
  } catch (error) {
    console.error('Error creating vehicle:', error);
    res.status(500).json({ error: 'Failed to create vehicle', details: error.message || error });
  }
});

// PUT /api/vehicles/:id - update vehicle
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { registration_number, model, consumption } = req.body;

  if (!registration_number || !model) {
    return res.status(400).json({ error: 'Registration number and vehicle model are required' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM delivery_vehicles WHERE registration_number = ? AND id != ?',
      [registration_number, id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A vehicle with this registration number already exists' });
    }

    const sql = 'UPDATE delivery_vehicles SET registration_number = ?, model = ?, consumption = ? WHERE id = ?';
    const [result] = await db.query(sql, [registration_number, model, consumption || null, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({
      success: true,
      data: { id: parseInt(id), registration_number, model, consumption },
      message: 'Vehicle updated successfully'
    });
  } catch (error) {
    console.error('Error updating vehicle:', error);
    res.status(500).json({ error: 'Failed to update vehicle', details: error.message || error });
  }
});

// DELETE /api/vehicles/:id - delete vehicle
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM delivery_vehicles WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ error: 'Failed to delete vehicle', details: error.message || error });
  }
});

module.exports = router;
