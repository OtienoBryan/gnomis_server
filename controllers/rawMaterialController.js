const db = require('../database/db');

const COLUMNS = 'id, name, unit, cost, alert_qty, is_active, created_at, updated_at';

const isDuplicate = (error) => error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062);

const parseAlertQty = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// A product that has a recipe costs the sum of (quantity x cost) of its raw materials.
// Recalculates cost_price for one product, or for every product that uses the given raw material.
const recalcProductCosts = async (conn, { productId, rawMaterialId }) => {
  const costSql = `(SELECT COALESCE(SUM(r.quantity * rm.cost), 0)
                    FROM product_recipes r
                    JOIN raw_materials rm ON rm.id = r.raw_material_id
                    WHERE r.product_id = p.id)`;
  if (productId) {
    await conn.query(`UPDATE products p SET p.cost_price = ${costSql} WHERE p.id = ?`, [productId]);
  } else if (rawMaterialId) {
    await conn.query(
      `UPDATE products p SET p.cost_price = ${costSql}
       WHERE p.id IN (SELECT product_id FROM product_recipes WHERE raw_material_id = ?)`,
      [rawMaterialId]
    );
  }
};

const listRawMaterials = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${COLUMNS} FROM raw_materials ORDER BY is_active DESC, name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching raw materials:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raw materials' });
  }
};

const createRawMaterial = async (req, res) => {
  try {
    const name = (req.body?.name ?? '').toString().trim();
    const unit = (req.body?.unit ?? '').toString().trim();
    const alertQty = parseAlertQty(req.body?.alert_qty ?? 0);
    const cost = parseAlertQty(req.body?.cost ?? 0);
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!unit) return res.status(400).json({ success: false, error: 'Unit is required' });
    if (alertQty === null) return res.status(400).json({ success: false, error: 'Alert qty must be a number of 0 or more' });
    if (cost === null) return res.status(400).json({ success: false, error: 'Cost must be a number of 0 or more' });

    const [result] = await db.query(
      'INSERT INTO raw_materials (name, unit, cost, alert_qty, is_active) VALUES (?, ?, ?, ?, 1)',
      [name, unit, cost, alertQty]
    );
    const [rows] = await db.query(`SELECT ${COLUMNS} FROM raw_materials WHERE id = ?`, [result.insertId]);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (isDuplicate(error)) return res.status(409).json({ success: false, error: 'This raw material already exists' });
    console.error('Error creating raw material:', error);
    res.status(500).json({ success: false, error: 'Failed to create raw material' });
  }
};

const updateRawMaterial = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid raw material id' });

    const { name, unit, cost, alert_qty, is_active } = req.body || {};
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const v = name.toString().trim();
      if (!v) return res.status(400).json({ success: false, error: 'Name cannot be empty' });
      updates.push('name = ?');
      params.push(v);
    }
    if (unit !== undefined) {
      const v = unit.toString().trim();
      if (!v) return res.status(400).json({ success: false, error: 'Unit cannot be empty' });
      updates.push('unit = ?');
      params.push(v);
    }
    if (cost !== undefined) {
      const v = parseAlertQty(cost);
      if (v === null) return res.status(400).json({ success: false, error: 'Cost must be a number of 0 or more' });
      updates.push('cost = ?');
      params.push(v);
    }
    if (alert_qty !== undefined) {
      const v = parseAlertQty(alert_qty);
      if (v === null) return res.status(400).json({ success: false, error: 'Alert qty must be a number of 0 or more' });
      updates.push('alert_qty = ?');
      params.push(v);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(Number(is_active) ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });

    params.push(id);
    const [result] = await db.query(`UPDATE raw_materials SET ${updates.join(', ')} WHERE id = ?`, params);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Raw material not found' });

    if (cost !== undefined) {
      try {
        await recalcProductCosts(db, { rawMaterialId: id });
      } catch (e) {
        console.warn('Could not recalculate product costs:', e?.message);
      }
    }

    const [rows] = await db.query(`SELECT ${COLUMNS} FROM raw_materials WHERE id = ?`, [id]);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (isDuplicate(error)) return res.status(409).json({ success: false, error: 'This raw material already exists' });
    console.error('Error updating raw material:', error);
    res.status(500).json({ success: false, error: 'Failed to update raw material' });
  }
};

const deleteRawMaterial = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid raw material id' });

    const [result] = await db.query('DELETE FROM raw_materials WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Raw material not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting raw material:', error);
    res.status(500).json({ success: false, error: 'Failed to delete raw material' });
  }
};

// ──────────────────────────── Ledger ────────────────────────────
const toDateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Returns ledger entries with a running balance per raw material, plus a balance summary per material.
// Optional filters: raw_material_id, start_date, end_date (balances always reflect full history).
const getLedger = async (req, res) => {
  try {
    const materialId = req.query.raw_material_id ? Number(req.query.raw_material_id) : null;
    const { start_date, end_date } = req.query;

    const [materials] = await db.query(`SELECT ${COLUMNS} FROM raw_materials ORDER BY name ASC`);
    const [txns] = await db.query(
      `SELECT t.id, t.raw_material_id, t.store_id, t.transaction_date, t.type, t.quantity, t.reference, t.notes, t.created_at
       FROM raw_material_transactions t
       ORDER BY t.transaction_date ASC, t.id ASC`
    );

    const balances = new Map();
    const entries = [];
    const nameById = new Map(materials.map(m => [m.id, m]));
    const [storeRows] = await db.query('SELECT id, store_name FROM stores');
    const storeNameById = new Map(storeRows.map(st => [st.id, st.store_name]));

    txns.forEach(t => {
      const qty = Number(t.quantity);
      const balance = (balances.get(t.raw_material_id) || 0) + (t.type === 'in' ? qty : -qty);
      balances.set(t.raw_material_id, balance);
      const date = toDateStr(t.transaction_date);
      const m = nameById.get(t.raw_material_id);
      entries.push({
        id: t.id,
        raw_material_id: t.raw_material_id,
        store_id: t.store_id,
        store_name: t.store_id ? storeNameById.get(t.store_id) || null : null,
        name: m?.name,
        unit: m?.unit,
        transaction_date: date,
        type: t.type,
        quantity: qty,
        reference: t.reference,
        notes: t.notes,
        balance,
      });
    });

    const filtered = entries
      .filter(e => !materialId || e.raw_material_id === materialId)
      .filter(e => !start_date || e.transaction_date >= start_date)
      .filter(e => !end_date || e.transaction_date <= end_date)
      .reverse(); // newest first

    const summary = materials.map(m => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      alert_qty: Number(m.alert_qty),
      is_active: m.is_active,
      balance: balances.get(m.id) || 0,
    }));

    res.json({ success: true, data: { entries: filtered, summary } });
  } catch (error) {
    console.error('Error fetching raw material ledger:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raw material ledger' });
  }
};

const createLedgerEntry = async (req, res) => {
  try {
    const materialId = Number(req.body?.raw_material_id);
    const type = req.body?.type;
    const storeId = req.body?.store_id ? Number(req.body.store_id) : null;
    const quantity = Number(req.body?.quantity);
    const date = (req.body?.transaction_date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10);
    const reference = (req.body?.reference ?? '').toString().trim() || null;
    const notes = (req.body?.notes ?? '').toString().trim() || null;

    if (!Number.isFinite(materialId)) return res.status(400).json({ success: false, error: 'Raw material is required' });
    if (storeId !== null && !Number.isFinite(storeId)) return res.status(400).json({ success: false, error: 'Invalid store' });
    if (type !== 'in' && type !== 'out') return res.status(400).json({ success: false, error: 'Type must be "in" or "out"' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ success: false, error: 'Quantity must be greater than 0' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date' });

    const [mat] = await db.query('SELECT id FROM raw_materials WHERE id = ?', [materialId]);
    if (!mat.length) return res.status(404).json({ success: false, error: 'Raw material not found' });

    if (type === 'out') {
      const [[bal]] = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS balance
         FROM raw_material_transactions WHERE raw_material_id = ? AND store_id <=> ?`,
        [materialId, storeId]
      );
      if (Number(bal.balance) < quantity) {
        return res.status(400).json({ success: false, error: `Insufficient stock. Available: ${Number(bal.balance)}` });
      }
    }

    const [result] = await db.query(
      `INSERT INTO raw_material_transactions (raw_material_id, store_id, transaction_date, type, quantity, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [materialId, storeId, date, type, quantity, reference, notes, req.user?.id || null]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (error) {
    console.error('Error creating ledger entry:', error);
    res.status(500).json({ success: false, error: 'Failed to create ledger entry' });
  }
};

const deleteLedgerEntry = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid entry id' });
    const [result] = await db.query('DELETE FROM raw_material_transactions WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ledger entry:', error);
    res.status(500).json({ success: false, error: 'Failed to delete ledger entry' });
  }
};

// Current stock of each raw material in each store (sum of ledger movements).
// Movements with no store are reported separately as "unassigned".
const getInventory = async (_req, res) => {
  try {
    const [materials] = await db.query(
      'SELECT * FROM raw_materials WHERE is_active = 1 ORDER BY name ASC'
    );
    const [stores] = await db.query(
      'SELECT id, store_name, store_code FROM stores WHERE is_active = 1 ORDER BY store_name ASC'
    );
    const [balances] = await db.query(
      `SELECT raw_material_id, store_id,
              SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS balance
       FROM raw_material_transactions
       GROUP BY raw_material_id, store_id`
    );

    const byMaterial = new Map();
    balances.forEach(b => {
      if (!byMaterial.has(b.raw_material_id)) byMaterial.set(b.raw_material_id, { by_store: {}, unassigned: 0 });
      const entry = byMaterial.get(b.raw_material_id);
      if (b.store_id === null) entry.unassigned = Number(b.balance);
      else entry.by_store[b.store_id] = Number(b.balance);
    });

    const data = materials.map(m => {
      const e = byMaterial.get(m.id) || { by_store: {}, unassigned: 0 };
      const total = Object.values(e.by_store).reduce((sum, v) => sum + v, 0) + e.unassigned;
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        alert_qty: Number(m.alert_qty),
        cost: Number(m.cost) || 0,
        by_store: e.by_store,
        unassigned: e.unassigned,
        total,
      };
    });

    res.json({ success: true, data: { stores, materials: data } });
  } catch (error) {
    console.error('Error fetching raw material inventory:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raw material inventory' });
  }
};

// ──────────────────────────── Product recipes ────────────────────────────
const getProductRecipe = async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isFinite(productId)) return res.status(400).json({ success: false, error: 'Invalid product id' });
    const [rows] = await db.query(
      `SELECT r.raw_material_id, r.quantity, rm.name, rm.unit, rm.cost
       FROM product_recipes r
       JOIN raw_materials rm ON rm.id = r.raw_material_id
       WHERE r.product_id = ?
       ORDER BY rm.name ASC`,
      [productId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching product recipe:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product recipe' });
  }
};

// Replaces the whole recipe of a product with the given list of { raw_material_id, quantity }
const setProductRecipe = async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) return res.status(400).json({ success: false, error: 'Invalid product id' });

  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ success: false, error: 'Items are required' });

  const seen = new Set();
  const cleaned = [];
  for (const it of items) {
    const rawId = Number(it?.raw_material_id);
    const qty = Number(it?.quantity);
    if (!Number.isFinite(rawId)) return res.status(400).json({ success: false, error: 'Each line needs a raw material' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: 'Quantity must be greater than 0' });
    if (seen.has(rawId)) return res.status(400).json({ success: false, error: 'A raw material can only appear once in a recipe' });
    seen.add(rawId);
    cleaned.push([productId, rawId, qty]);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [prod] = await connection.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prod.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    await connection.query('DELETE FROM product_recipes WHERE product_id = ?', [productId]);
    if (cleaned.length) {
      await connection.query('INSERT INTO product_recipes (product_id, raw_material_id, quantity) VALUES ?', [cleaned]);
    }
    // Product cost = total cost of its recipe (left untouched when the recipe is emptied)
    let costPrice = null;
    if (cleaned.length) {
      await recalcProductCosts(connection, { productId });
      const [[row]] = await connection.query('SELECT cost_price FROM products WHERE id = ?', [productId]);
      costPrice = Number(row.cost_price);
    }
    await connection.commit();
    res.json({ success: true, cost_price: costPrice });
  } catch (error) {
    await connection.rollback();
    console.error('Error saving product recipe:', error);
    res.status(500).json({ success: false, error: 'Failed to save product recipe' });
  } finally {
    connection.release();
  }
};

module.exports = {
  listRawMaterials, createRawMaterial, updateRawMaterial, deleteRawMaterial,
  getLedger, createLedgerEntry, deleteLedgerEntry, getInventory,
  getProductRecipe, setProductRecipe, recalcProductCosts
};
