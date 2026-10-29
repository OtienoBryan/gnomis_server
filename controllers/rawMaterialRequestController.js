const db = require('../database/db');

const userName = 'u.name';

// List of requests, newest first
const listRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE r.status = ?' : '';
    const [rows] = await db.query(
      `SELECT r.id, r.request_number, r.status, r.notes, r.created_at,
              ${userName} AS requested_by_name,
              (SELECT COUNT(*) FROM raw_material_request_products p WHERE p.request_id = r.id) AS product_count,
              (SELECT COUNT(*) FROM raw_material_request_items i WHERE i.request_id = r.id) AS material_count
       FROM raw_material_requests r
       LEFT JOIN staff u ON u.id = r.requested_by
       ${where}
       ORDER BY r.created_at DESC, r.id DESC`,
      status ? [status] : []
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching raw material requests:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch requests' });
  }
};

// One request with the products to be made and the raw materials requested
const getRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid request id' });

    const [requests] = await db.query(
      `SELECT r.*, ${userName} AS requested_by_name,
              rv.name AS reviewed_by_name, cb.name AS completed_by_name, st.store_name
       FROM raw_material_requests r
       LEFT JOIN staff u ON u.id = r.requested_by
       LEFT JOIN staff rv ON rv.id = r.reviewed_by
       LEFT JOIN staff cb ON cb.id = r.completed_by
       LEFT JOIN stores st ON st.id = r.store_id
       WHERE r.id = ?`,
      [id]
    );
    if (!requests.length) return res.status(404).json({ success: false, error: 'Request not found' });

    const [products] = await db.query(
      `SELECT rp.id, rp.product_id, rp.quantity, rp.produced_quantity, p.product_name
       FROM raw_material_request_products rp
       LEFT JOIN products p ON p.id = rp.product_id
       WHERE rp.request_id = ?
       ORDER BY p.product_name ASC`,
      [id]
    );
    const [items] = await db.query(
      `SELECT ri.id, ri.raw_material_id, ri.quantity, ri.used_quantity, ri.returned_quantity, rm.name, rm.unit
       FROM raw_material_request_items ri
       LEFT JOIN raw_materials rm ON rm.id = ri.raw_material_id
       WHERE ri.request_id = ?
       ORDER BY rm.name ASC`,
      [id]
    );
    res.json({ success: true, data: { ...requests[0], products, items } });
  } catch (error) {
    console.error('Error fetching raw material request:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch request' });
  }
};

// Create a request. New requests are always pending.
const createRequest = async (req, res) => {
  const products = Array.isArray(req.body?.products) ? req.body.products : [];
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const notes = (req.body?.notes ?? '').toString().trim() || null;

  const cleanLines = (lines, idKey, label) => {
    const seen = new Set();
    const out = [];
    for (const l of lines) {
      const id = Number(l?.[idKey]);
      const qty = Number(l?.quantity);
      if (!Number.isFinite(id)) throw new Error(`Each ${label} line needs a selection`);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantity must be greater than 0 for every ${label}`);
      if (seen.has(id)) throw new Error(`A ${label} can only appear once`);
      seen.add(id);
      out.push([id, qty]);
    }
    return out;
  };

  let cleanProducts;
  let cleanItems;
  try {
    cleanProducts = cleanLines(products, 'product_id', 'product');
    cleanItems = cleanLines(items, 'raw_material_id', 'raw material');
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
  if (!cleanProducts.length) return res.status(400).json({ success: false, error: 'Add at least one product to produce' });
  if (!cleanItems.length) return res.status(400).json({ success: false, error: 'Add at least one raw material to request' });

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Temporary unique number, replaced with RMR-###### from the new id
    const [result] = await connection.query(
      "INSERT INTO raw_material_requests (request_number, status, notes, requested_by) VALUES (?, 'pending', ?, ?)",
      [`TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`, notes, req.user?.id || null]
    );
    const requestId = result.insertId;
    const requestNumber = `RMR-${String(requestId).padStart(6, '0')}`;
    await connection.query('UPDATE raw_material_requests SET request_number = ? WHERE id = ?', [requestNumber, requestId]);

    await connection.query(
      'INSERT INTO raw_material_request_products (request_id, product_id, quantity) VALUES ?',
      [cleanProducts.map(([id, qty]) => [requestId, id, qty])]
    );
    await connection.query(
      'INSERT INTO raw_material_request_items (request_id, raw_material_id, quantity) VALUES ?',
      [cleanItems.map(([id, qty]) => [requestId, id, qty])]
    );

    await connection.commit();
    res.status(201).json({ success: true, data: { id: requestId, request_number: requestNumber, status: 'pending' } });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating raw material request:', error);
    res.status(500).json({ success: false, error: 'Failed to create request' });
  } finally {
    connection.release();
  }
};

// The stock role handles the raw materials but does not decide on requests
const isStockRole = (req) => String(req.user?.role || '').toLowerCase().trim() === 'stock';
const STOCK_REVIEW_ERROR = 'The stock role cannot approve or decline requests';

// Approve a pending request: check stock in the chosen store and, if there is enough of every
// raw material, deduct it (stock out entries on the raw material ledger). The request is then 'issued'.
const approveRequest = async (req, res) => {
  if (isStockRole(req)) return res.status(403).json({ success: false, error: STOCK_REVIEW_ERROR });
  const id = Number(req.params.id);
  const storeId = Number(req.body?.store_id);
  const note = (req.body?.note ?? '').toString().trim() || null;
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid request id' });
  if (!Number.isFinite(storeId)) return res.status(400).json({ success: false, error: 'Choose the store to issue the raw materials from' });

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [requests] = await connection.query('SELECT * FROM raw_material_requests WHERE id = ? FOR UPDATE', [id]);
    if (!requests.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    const request = requests[0];
    if (request.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: `This request is already ${request.status}` });
    }

    const [stores] = await connection.query('SELECT id FROM stores WHERE id = ?', [storeId]);
    if (!stores.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Store not found' });
    }

    const [items] = await connection.query(
      `SELECT ri.raw_material_id, ri.quantity, rm.name, rm.unit
       FROM raw_material_request_items ri
       JOIN raw_materials rm ON rm.id = ri.raw_material_id
       WHERE ri.request_id = ?`,
      [id]
    );
    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'This request has no raw materials' });
    }

    // Lock the raw materials involved so two approvals can't both use the same stock
    await connection.query(
      'SELECT id FROM raw_materials WHERE id IN (?) FOR UPDATE',
      [items.map(i => i.raw_material_id)]
    );

    const shortages = [];
    for (const item of items) {
      const [[row]] = await connection.query(
        `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS balance
         FROM raw_material_transactions
         WHERE raw_material_id = ? AND store_id = ?`,
        [item.raw_material_id, storeId]
      );
      const available = Number(row.balance);
      if (available < Number(item.quantity)) {
        shortages.push({ name: item.name, unit: item.unit, requested: Number(item.quantity), available });
      }
    }
    if (shortages.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Not enough stock to approve this request',
        shortages,
      });
    }

    for (const item of items) {
      await connection.query(
        `INSERT INTO raw_material_transactions
           (raw_material_id, store_id, transaction_date, type, quantity, reference, notes, created_by)
         VALUES (?, ?, CURDATE(), 'out', ?, ?, ?, ?)`,
        [item.raw_material_id, storeId, item.quantity, request.request_number, 'Issued for raw material request', req.user?.id || null]
      );
    }

    await connection.query(
      `UPDATE raw_material_requests
       SET status = 'issued', store_id = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
       WHERE id = ?`,
      [storeId, req.user?.id || null, note, id]
    );

    await connection.commit();
    res.json({ success: true, data: { id, status: 'issued' } });
  } catch (error) {
    await connection.rollback();
    console.error('Error approving raw material request:', error);
    res.status(500).json({ success: false, error: 'Failed to approve request' });
  } finally {
    connection.release();
  }
};

// Decline a pending request (no stock is touched)
const declineRequest = async (req, res) => {
  if (isStockRole(req)) return res.status(403).json({ success: false, error: STOCK_REVIEW_ERROR });
  try {
    const id = Number(req.params.id);
    const note = (req.body?.note ?? '').toString().trim() || null;
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid request id' });

    const [result] = await db.query(
      `UPDATE raw_material_requests
       SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_note = ?
       WHERE id = ? AND status = 'pending'`,
      [req.user?.id || null, note, id]
    );
    if (!result.affectedRows) {
      return res.status(400).json({ success: false, error: 'Only a pending request can be declined' });
    }
    res.json({ success: true, data: { id, status: 'rejected' } });
  } catch (error) {
    console.error('Error declining raw material request:', error);
    res.status(500).json({ success: false, error: 'Failed to decline request' });
  }
};

// Confirm production for an issued request: record what was produced and how much of each raw
// material was actually used.
//  - Raw material issued but not used goes back into stock (a stock in entry on the raw material
//    ledger, in the store it was issued from).
//  - The products that were produced are added to that store's inventory, with an entry on the
//    product inventory ledger (inventory_transactions).
const completeRequest = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Invalid request id' });

  const producedInput = Array.isArray(req.body?.products) ? req.body.products : [];
  const usedInput = Array.isArray(req.body?.items) ? req.body.items : [];
  const note = (req.body?.note ?? '').toString().trim() || null;
  const round3 = (n) => Math.round(n * 1000) / 1000;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [requests] = await connection.query('SELECT * FROM raw_material_requests WHERE id = ? FOR UPDATE', [id]);
    if (!requests.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    const request = requests[0];
    if (request.status !== 'issued') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: request.status === 'completed' ? 'Production has already been confirmed for this request' : 'Only an issued request can be confirmed'
      });
    }
    if (!request.store_id) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'This request has no issuing store' });
    }

    const [products] = await connection.query('SELECT id, product_id FROM raw_material_request_products WHERE request_id = ?', [id]);
    const [items] = await connection.query(
      'SELECT id, raw_material_id, quantity FROM raw_material_request_items WHERE request_id = ?',
      [id]
    );

    // Validate everything before changing anything
    const producedById = new Map(producedInput.map(p => [Number(p.product_id), Number(p.produced_quantity)]));
    for (const p of products) {
      const produced = producedById.get(p.product_id);
      if (produced === undefined || !Number.isFinite(produced) || produced < 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Enter the quantity produced for every product (0 or more)' });
      }
    }
    const usedById = new Map(usedInput.map(i => [Number(i.raw_material_id), Number(i.used_quantity)]));
    const itemPlans = [];
    for (const item of items) {
      const used = usedById.get(item.raw_material_id);
      const issued = Number(item.quantity);
      if (used === undefined || !Number.isFinite(used) || used < 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Enter the quantity used for every raw material (0 or more)' });
      }
      if (used > issued + 1e-9) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'The quantity used cannot be more than the quantity issued' });
      }
      itemPlans.push({ item, used: round3(used), returned: round3(Math.max(0, issued - used)) });
    }

    for (const p of products) {
      const producedQty = producedById.get(p.product_id);
      await connection.query('UPDATE raw_material_request_products SET produced_quantity = ? WHERE id = ?', [producedQty, p.id]);

      if (producedQty > 0) {
        // Add the produced quantity to the store's inventory
        const [existing] = await connection.query(
          'SELECT quantity FROM store_inventory WHERE store_id = ? AND product_id = ?',
          [request.store_id, p.product_id]
        );
        const previousQty = existing.length ? Number(existing[0].quantity) : 0;
        const newQty = previousQty + producedQty;
        if (existing.length) {
          await connection.query(
            'UPDATE store_inventory SET quantity = ?, updated_at = NOW() WHERE store_id = ? AND product_id = ?',
            [newQty, request.store_id, p.product_id]
          );
        } else {
          await connection.query(
            'INSERT INTO store_inventory (store_id, product_id, quantity, updated_at) VALUES (?, ?, ?, NOW())',
            [request.store_id, p.product_id, newQty]
          );
        }

        // Entry on the product inventory ledger, costed at the product's current cost (its recipe cost)
        const [[prod]] = await connection.query('SELECT cost_price FROM products WHERE id = ?', [p.product_id]);
        const unitCost = Number(prod?.cost_price) || 0;
        await connection.query(
          `INSERT INTO inventory_transactions
             (product_id, reference, amount_in, amount_out, balance, date_received, store_id, unit_cost, total_cost, staff_id)
           VALUES (?, ?, ?, 0, ?, NOW(), ?, ?, ?, ?)`,
          [p.product_id, request.request_number, producedQty, newQty, request.store_id, unitCost, unitCost * producedQty, req.user?.id || 1]
        );
      }
    }
    for (const plan of itemPlans) {
      await connection.query(
        'UPDATE raw_material_request_items SET used_quantity = ?, returned_quantity = ? WHERE id = ?',
        [plan.used, plan.returned, plan.item.id]
      );
      if (plan.returned > 0) {
        await connection.query(
          `INSERT INTO raw_material_transactions
             (raw_material_id, store_id, transaction_date, type, quantity, reference, notes, created_by)
           VALUES (?, ?, CURDATE(), 'in', ?, ?, ?, ?)`,
          [plan.item.raw_material_id, request.store_id, plan.returned, request.request_number, 'Unused raw materials returned to stock', req.user?.id || null]
        );
      }
    }

    await connection.query(
      `UPDATE raw_material_requests
       SET status = 'completed', completed_by = ?, completed_at = NOW(), production_note = ?
       WHERE id = ?`,
      [req.user?.id || null, note, id]
    );

    await connection.commit();
    res.json({ success: true, data: { id, status: 'completed' } });
  } catch (error) {
    await connection.rollback();
    console.error('Error confirming production:', error);
    res.status(500).json({ success: false, error: 'Failed to confirm production' });
  } finally {
    connection.release();
  }
};

// Raw materials actually used in production: one row per raw material per completed request.
// Filtered by the date production was confirmed (start_date / end_date, inclusive).
const getUsage = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = ["r.status = 'completed'", 'ri.used_quantity IS NOT NULL'];
    const params = [];
    if (start_date) { where.push('DATE(r.completed_at) >= ?'); params.push(start_date); }
    if (end_date) { where.push('DATE(r.completed_at) <= ?'); params.push(end_date); }

    const [rows] = await db.query(
      `SELECT ri.raw_material_id, rm.name, rm.unit, rm.cost,
              ri.quantity AS issued_quantity, ri.used_quantity, ri.returned_quantity,
              r.id AS request_id, r.request_number, r.completed_at, st.store_name
       FROM raw_material_request_items ri
       JOIN raw_material_requests r ON r.id = ri.request_id
       JOIN raw_materials rm ON rm.id = ri.raw_material_id
       LEFT JOIN stores st ON st.id = r.store_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.completed_at DESC, r.id DESC, rm.name ASC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching raw material usage:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raw material usage' });
  }
};

// Products actually produced: one row per product per completed request.
// Filtered by the date production was confirmed (start_date / end_date, inclusive).
const getProduced = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = ["r.status = 'completed'", 'rp.produced_quantity IS NOT NULL'];
    const params = [];
    if (start_date) { where.push('DATE(r.completed_at) >= ?'); params.push(start_date); }
    if (end_date) { where.push('DATE(r.completed_at) <= ?'); params.push(end_date); }

    const [rows] = await db.query(
      `SELECT rp.product_id, p.product_name, p.product_code, p.category,
              rp.quantity AS target_quantity, rp.produced_quantity,
              r.id AS request_id, r.request_number, r.completed_at, st.store_name
       FROM raw_material_request_products rp
       JOIN raw_material_requests r ON r.id = rp.request_id
       JOIN products p ON p.id = rp.product_id
       LEFT JOIN stores st ON st.id = r.store_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.completed_at DESC, r.id DESC, p.product_name ASC`,
      params
    );
    // Recipes (raw material per unit) let the client work out materials used per product
    let recipes = [];
    const productIds = [...new Set(rows.map(r => r.product_id))];
    if (productIds.length > 0) {
      try {
        [recipes] = await db.query(
          `SELECT pr.product_id, pr.raw_material_id, pr.quantity, rm.name, rm.unit
           FROM product_recipes pr
           JOIN raw_materials rm ON rm.id = pr.raw_material_id
           WHERE pr.product_id IN (?)
           ORDER BY rm.name ASC`,
          [productIds]
        );
      } catch (e) { /* recipes table not created yet */ }
    }
    res.json({ success: true, data: rows, recipes });
  } catch (error) {
    console.error('Error fetching produced products:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch produced products' });
  }
};

module.exports = { listRequests, getRequest, createRequest, approveRequest, declineRequest, completeRequest, getUsage, getProduced };



