const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// ---- Driver assignments ----
// Drivers are SalesRep rows with role = 'driver'. A driver is assigned to one vehicle at a time
// (driver_id is unique) and a vehicle has at most one driver (enforced in PUT /:id/drivers).
let assignmentsTableReady = false;
const ensureAssignmentsTable = async () => {
  if (assignmentsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_drivers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id INT NOT NULL,
      driver_id INT NOT NULL,
      assigned_by INT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vehicle_drivers_driver (driver_id),
      KEY idx_vehicle_drivers_vehicle (vehicle_id)
    )
  `);
  assignmentsTableReady = true;
};

// GET /api/vehicles/fuelings?start=YYYY-MM-DD&end=YYYY-MM-DD&vehicle_id=&driver_id=&status=
// Fuelings recorded by drivers (vehicle_fuelings), newest first. Dates filter on created_at.
router.get('/fuelings', async (req, res) => {
  const { start, end, vehicle_id, driver_id, status } = req.query;
  const where = [];
  const params = [];
  if (start) { where.push('f.created_at >= ?'); params.push(`${start} 00:00:00`); }
  if (end) { where.push('f.created_at <= ?'); params.push(`${end} 23:59:59`); }
  if (vehicle_id) { where.push('f.vehicle_id = ?'); params.push(vehicle_id); }
  if (driver_id) { where.push('f.driver_id = ?'); params.push(driver_id); }
  if (status) { where.push('f.status = ?'); params.push(status); }
  try {
    const [rows] = await db.query(
      `SELECT f.*, v.registration_number, v.model AS vehicle_model, s.name AS driver_name,
              (SELECT p.odo_reading FROM vehicle_fuelings p
                WHERE p.vehicle_id = f.vehicle_id AND p.odo_reading IS NOT NULL AND p.id < f.id
                ORDER BY p.id DESC LIMIT 1) AS prev_odo_reading
       FROM vehicle_fuelings f
       LEFT JOIN delivery_vehicles v ON v.id = f.vehicle_id
       LEFT JOIN SalesRep s ON s.id = f.driver_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY f.created_at DESC, f.id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching fuelings:', error);
    res.status(500).json({ error: 'Failed to fetch fuelings', details: error.message || error });
  }
});

// ---- Vehicle models (name + standard fuel consumption in km/l) ----
const DEFAULT_MODELS = [
  'Isuzu NPR', 'Isuzu NQR', 'Isuzu FRR', 'Isuzu FVR', 'Isuzu ELF', 'Mitsubishi Canter', 'Mitsubishi Fuso',
  'Toyota Hiace', 'Toyota Dyna', 'Nissan Atlas', 'Nissan UD', 'Foton Aumark', 'Tata Ace', 'Ford Transit'
];
let modelsTableReady = false;
const ensureModelsTable = async () => {
  if (modelsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_models (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      consumption DECIMAL(6,2) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vehicle_models_name (name)
    )
  `);
  // First use: start from the built-in list, plus any model already used by a vehicle
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM vehicle_models');
  if (n === 0) {
    const [used] = await db.query(
      'SELECT model, AVG(consumption) AS consumption FROM delivery_vehicles WHERE model <> "" GROUP BY model'
    );
    const usedMap = new Map(used.map(u => [u.model, u.consumption != null ? Number(u.consumption) : null]));
    const names = [...new Set([...DEFAULT_MODELS, ...usedMap.keys()])];
    for (const name of names) {
      await db.query('INSERT IGNORE INTO vehicle_models (name, consumption) VALUES (?, ?)', [name, usedMap.get(name) ?? null]);
    }
  }
  modelsTableReady = true;
};

// GET /api/vehicles/models - models with how many vehicles use each
router.get('/models', async (req, res) => {
  try {
    await ensureModelsTable();
    const [rows] = await db.query(`
      SELECT m.id, m.name, m.consumption, COUNT(v.id) AS vehicle_count
      FROM vehicle_models m
      LEFT JOIN delivery_vehicles v ON v.model = m.name
      GROUP BY m.id, m.name, m.consumption
      ORDER BY m.name
    `);
    res.json({ success: true, data: rows.map(r => ({ ...r, vehicle_count: Number(r.vehicle_count) })) });
  } catch (error) {
    console.error('Error fetching vehicle models:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle models', details: error.message || error });
  }
});

const parseConsumption = (value) => {
  if (value === '' || value == null) return { ok: true, value: null };
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
};

// POST /api/vehicles/models - { name, consumption }
router.post('/models', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const consumption = parseConsumption(req.body.consumption);
  if (!name) return res.status(400).json({ error: 'Model name is required' });
  if (!consumption.ok) return res.status(400).json({ error: 'Consumption must be a positive number' });
  try {
    await ensureModelsTable();
    const [dup] = await db.query('SELECT id FROM vehicle_models WHERE name = ?', [name]);
    if (dup.length) return res.status(409).json({ error: 'This model already exists' });
    const [result] = await db.query('INSERT INTO vehicle_models (name, consumption) VALUES (?, ?)', [name, consumption.value]);
    res.status(201).json({ success: true, data: { id: result.insertId, name, consumption: consumption.value } });
  } catch (error) {
    console.error('Error creating vehicle model:', error);
    res.status(500).json({ error: 'Failed to create vehicle model', details: error.message || error });
  }
});

// PUT /api/vehicles/models/:id - { name, consumption }; renaming also renames it on the vehicles using it.
// With apply_to_vehicles: true the consumption is also copied to every vehicle of this model.
router.put('/models/:id', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const consumption = parseConsumption(req.body.consumption);
  if (!name) return res.status(400).json({ error: 'Model name is required' });
  if (!consumption.ok) return res.status(400).json({ error: 'Consumption must be a positive number' });
  let conn;
  try {
    await ensureModelsTable();
    const [current] = await db.query('SELECT id, name FROM vehicle_models WHERE id = ?', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Model not found' });
    const [dup] = await db.query('SELECT id FROM vehicle_models WHERE name = ? AND id <> ?', [name, req.params.id]);
    if (dup.length) return res.status(409).json({ error: 'Another model already has this name' });

    conn = await db.getConnection();
    await conn.beginTransaction();
    await conn.query('UPDATE vehicle_models SET name = ?, consumption = ? WHERE id = ?', [name, consumption.value, req.params.id]);
    if (current[0].name !== name) {
      await conn.query('UPDATE delivery_vehicles SET model = ? WHERE model = ?', [name, current[0].name]);
    }
    if (req.body.apply_to_vehicles) {
      await conn.query('UPDATE delivery_vehicles SET consumption = ? WHERE model = ?', [consumption.value, name]);
    }
    await conn.commit();
    res.json({ success: true, data: { id: Number(req.params.id), name, consumption: consumption.value } });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error updating vehicle model:', error);
    res.status(500).json({ error: 'Failed to update vehicle model', details: error.message || error });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/vehicles/models/:id - blocked while vehicles still use the model
router.delete('/models/:id', async (req, res) => {
  try {
    await ensureModelsTable();
    const [current] = await db.query('SELECT name FROM vehicle_models WHERE id = ?', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Model not found' });
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM delivery_vehicles WHERE model = ?', [current[0].name]);
    if (n > 0) {
      return res.status(409).json({ error: `${n} vehicle${n === 1 ? '' : 's'} still use this model. Change them first.` });
    }
    await db.query('DELETE FROM vehicle_models WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Model deleted' });
  } catch (error) {
    console.error('Error deleting vehicle model:', error);
    res.status(500).json({ error: 'Failed to delete vehicle model', details: error.message || error });
  }
});

// GET /api/vehicles - fetch all vehicles with their assigned drivers
router.get('/', async (req, res) => {
  try {
    await ensureAssignmentsTable();
    const [rows] = await db.query(
      'SELECT id, registration_number, model, consumption, status, created_at FROM delivery_vehicles ORDER BY created_at DESC'
    );
    const [assigned] = await db.query(`
      SELECT vd.vehicle_id, vd.driver_id, vd.assigned_at, s.name, s.phoneNumber AS contact
      FROM vehicle_drivers vd
      JOIN SalesRep s ON s.id = vd.driver_id
      ORDER BY s.name
    `);
    const byVehicle = {};
    for (const a of assigned) {
      (byVehicle[a.vehicle_id] = byVehicle[a.vehicle_id] || []).push({
        id: a.driver_id,
        name: a.name,
        contact: a.contact,
        assigned_at: a.assigned_at
      });
    }
    res.json({ success: true, data: rows.map(v => ({ ...v, drivers: byVehicle[v.id] || [] })) });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles', details: error.message || error });
  }
});

// GET /api/vehicles/drivers - all drivers with the vehicle each is currently assigned to
router.get('/drivers', async (req, res) => {
  try {
    await ensureAssignmentsTable();
    const [rows] = await db.query(`
      SELECT s.id, s.name, s.phoneNumber AS contact, s.status,
             vd.vehicle_id, v.registration_number AS vehicle_registration_number
      FROM SalesRep s
      LEFT JOIN vehicle_drivers vd ON vd.driver_id = s.id
      LEFT JOIN delivery_vehicles v ON v.id = vd.vehicle_id
      WHERE s.role = 'driver'
      ORDER BY s.name
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching drivers:', error);
    res.status(500).json({ error: 'Failed to fetch drivers', details: error.message || error });
  }
});

// PUT /api/vehicles/:id/drivers - set the vehicle's driver: { driver_ids: [id] } (empty = unassign).
// A driver currently on another vehicle is moved to this one.
router.put('/:id/drivers', async (req, res) => {
  const vehicleId = Number(req.params.id);
  const driverIds = [...new Set((req.body.driver_ids || []).map(Number).filter(Boolean))];
  let conn;
  if (driverIds.length > 1) {
    return res.status(400).json({ error: 'Only one driver can be assigned to a vehicle' });
  }
  try {
    await ensureAssignmentsTable();
    const [vehicle] = await db.query('SELECT id FROM delivery_vehicles WHERE id = ?', [vehicleId]);
    if (!vehicle.length) return res.status(404).json({ error: 'Vehicle not found' });

    if (driverIds.length) {
      const [valid] = await db.query(
        `SELECT id FROM SalesRep WHERE role = 'driver' AND id IN (${driverIds.map(() => '?').join(',')})`,
        driverIds
      );
      if (valid.length !== driverIds.length) {
        return res.status(400).json({ error: 'One or more selected drivers were not found' });
      }
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    if (driverIds.length) {
      await conn.query(
        `DELETE FROM vehicle_drivers WHERE vehicle_id = ? AND driver_id NOT IN (${driverIds.map(() => '?').join(',')})`,
        [vehicleId, ...driverIds]
      );
      for (const driverId of driverIds) {
        // Keeps the original assigned_at when the driver is already on this vehicle; moves them otherwise
        await conn.query(
          `INSERT INTO vehicle_drivers (vehicle_id, driver_id, assigned_by) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             assigned_at = IF(vehicle_id = VALUES(vehicle_id), assigned_at, CURRENT_TIMESTAMP),
             assigned_by = IF(vehicle_id = VALUES(vehicle_id), assigned_by, VALUES(assigned_by)),
             vehicle_id = VALUES(vehicle_id)`,
          [vehicleId, driverId, req.user?.id || null]
        );
      }
    } else {
      await conn.query('DELETE FROM vehicle_drivers WHERE vehicle_id = ?', [vehicleId]);
    }
    await conn.commit();
    res.json({ success: true, message: 'Drivers updated' });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error assigning drivers:', error);
    res.status(500).json({ error: 'Failed to assign drivers', details: error.message || error });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/vehicles/:id/drivers/:driverId - unassign one driver
router.delete('/:id/drivers/:driverId', async (req, res) => {
  try {
    await ensureAssignmentsTable();
    await db.query('DELETE FROM vehicle_drivers WHERE vehicle_id = ? AND driver_id = ?', [req.params.id, req.params.driverId]);
    res.json({ success: true, message: 'Driver unassigned' });
  } catch (error) {
    console.error('Error unassigning driver:', error);
    res.status(500).json({ error: 'Failed to unassign driver', details: error.message || error });
  }
});

// PATCH /api/vehicles/:id/status - { status: 1 (active) | 0 (inactive) }
router.patch('/:id/status', async (req, res) => {
  const status = Number(req.body.status) ? 1 : 0;
  try {
    const [result] = await db.query('UPDATE delivery_vehicles SET status = ? WHERE id = ?', [status, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ success: true, data: { id: Number(req.params.id), status } });
  } catch (error) {
    console.error('Error updating vehicle status:', error);
    res.status(500).json({ error: 'Failed to update vehicle status', details: error.message || error });
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

    await ensureAssignmentsTable();
    await db.query('DELETE FROM vehicle_drivers WHERE vehicle_id = ?', [id]);

    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ error: 'Failed to delete vehicle', details: error.message || error });
  }
});

module.exports = router;
