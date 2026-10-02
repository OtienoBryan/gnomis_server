const db = require('../database/db');
const { recordOrderAssigned, recordOrderDelivered, recordOrderCancelled } = require('../utils/orderDetailsTracker');

const VALID_STATUSES = ['assigned', 'in_transit', 'delivered', 'cancelled'];
// Terminal statuses cannot transition to anything else
const TERMINAL_STATUSES = ['delivered', 'cancelled'];

const ORDER_STATUS_MAP = {
  in_transit: { status: 'shipped', my_status: 2 },
  delivered: { status: 'delivered', my_status: 3 },
  cancelled: { status: 'cancelled', my_status: 4 }
};

// If every order on a sheet has reached a final status (delivered/cancelled/declined), auto-close the sheet
const autoCloseSheetIfComplete = async (connection, sheetId) => {
  const [sheetRows] = await connection.query('SELECT status FROM loading_sheets WHERE id = ?', [sheetId]);
  if (sheetRows.length === 0 || TERMINAL_STATUSES.includes(sheetRows[0].status)) return;

  const [allOrders] = await connection.query(
    `SELECT so.my_status FROM loading_sheet_orders lso
     JOIN sales_orders so ON lso.sales_order_id = so.id
     WHERE lso.loading_sheet_id = ?`,
    [sheetId]
  );
  const allTerminal = allOrders.length > 0 && allOrders.every(o => [3, 4, 5].includes(o.my_status));
  if (allTerminal) {
    const finalStatus = allOrders.some(o => o.my_status === 3) ? 'delivered' : 'cancelled';
    await connection.query('UPDATE loading_sheets SET status = ?, updated_at = NOW() WHERE id = ?', [finalStatus, sheetId]);
  }
};

const loadingSheetController = {
  // GET /api/financial/loading-sheet/approved-orders
  getApprovedOrders: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT
          so.id,
          so.so_number,
          so.order_date,
          so.total_amount,
          so.my_status,
          so.driver_id,
          so.vehicle_id,
          so.assigned_at,
          c.name as customer_name,
          d.name as driver_name,
          v.registration_number as vehicle_registration_number,
          v.model as vehicle_model
        FROM sales_orders so
        LEFT JOIN Clients c ON so.client_id = c.id
        LEFT JOIN SalesRep d ON so.driver_id = d.id AND d.role = 'driver'
        LEFT JOIN delivery_vehicles v ON so.vehicle_id = v.id
        WHERE so.my_status = 1 AND so.status = 'confirmed'
        ORDER BY so.order_date DESC, so.id DESC
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching approved orders for loading sheet:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch approved orders' });
    }
  },

  // GET /api/financial/loading-sheet
  getLoadingSheets: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT
          ls.id,
          ls.sheet_number,
          ls.driver_id,
          ls.vehicle_id,
          ls.status,
          ls.notes,
          ls.created_at,
          ls.updated_at,
          d.name as driver_name,
          v.registration_number as vehicle_registration_number,
          v.model as vehicle_model,
          u.full_name as created_by_name,
          (SELECT COUNT(*) FROM loading_sheet_orders lso WHERE lso.loading_sheet_id = ls.id) as order_count
        FROM loading_sheets ls
        LEFT JOIN SalesRep d ON ls.driver_id = d.id AND d.role = 'driver'
        LEFT JOIN delivery_vehicles v ON ls.vehicle_id = v.id
        LEFT JOIN users u ON ls.created_by = u.id
        ORDER BY ls.created_at DESC
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching loading sheets:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch loading sheets' });
    }
  },

  // GET /api/financial/loading-sheet/:id
  getLoadingSheetById: async (req, res) => {
    try {
      const { id } = req.params;
      const [sheets] = await db.query(`
        SELECT
          ls.id,
          ls.sheet_number,
          ls.driver_id,
          ls.vehicle_id,
          ls.status,
          ls.notes,
          ls.created_at,
          ls.updated_at,
          d.name as driver_name,
          d.phoneNumber as driver_contact,
          v.registration_number as vehicle_registration_number,
          v.model as vehicle_model,
          u.full_name as created_by_name
        FROM loading_sheets ls
        LEFT JOIN SalesRep d ON ls.driver_id = d.id AND d.role = 'driver'
        LEFT JOIN delivery_vehicles v ON ls.vehicle_id = v.id
        LEFT JOIN users u ON ls.created_by = u.id
        WHERE ls.id = ?
      `, [id]);

      if (sheets.length === 0) {
        return res.status(404).json({ success: false, error: 'Loading sheet not found' });
      }

      const [orders] = await db.query(`
        SELECT
          so.id,
          so.so_number,
          so.order_date,
          so.total_amount,
          so.my_status,
          c.name as customer_name,
          c.contact as customer_contact,
          c.address as customer_address
        FROM loading_sheet_orders lso
        JOIN sales_orders so ON lso.sales_order_id = so.id
        LEFT JOIN Clients c ON so.client_id = c.id
        WHERE lso.loading_sheet_id = ?
        ORDER BY so.id ASC
      `, [id]);

      const sheet = sheets[0];
      sheet.orders = orders;
      res.json({ success: true, data: sheet });
    } catch (error) {
      console.error('Error fetching loading sheet:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch loading sheet' });
    }
  },

  // POST /api/financial/loading-sheet
  createLoadingSheet: async (req, res) => {
    const { order_ids, driver_id, vehicle_id, notes } = req.body;

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one order must be selected' });
    }
    if (!driver_id) {
      return res.status(400).json({ success: false, error: 'driver_id is required' });
    }
    if (!vehicle_id) {
      return res.status(400).json({ success: false, error: 'vehicle_id is required' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [driverRows] = await connection.query("SELECT id, name FROM SalesRep WHERE id = ? AND role = 'driver'", [driver_id]);
      if (driverRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Selected driver not found' });
      }

      const [vehicleRows] = await connection.query(
        'SELECT id, registration_number FROM delivery_vehicles WHERE id = ?',
        [vehicle_id]
      );
      if (vehicleRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Selected vehicle not found' });
      }

      const placeholders = order_ids.map(() => '?').join(',');
      const [orderRows] = await connection.query(
        `SELECT id, my_status, status FROM sales_orders WHERE id IN (${placeholders})`,
        order_ids
      );
      if (orderRows.length !== order_ids.length) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'One or more selected orders were not found' });
      }
      const notApproved = orderRows.filter(o => o.my_status !== 1 || o.status !== 'confirmed');
      if (notApproved.length > 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Only confirmed, unassigned orders can be added to a loading sheet' });
      }

      const [countRows] = await connection.query('SELECT COUNT(*) as total FROM loading_sheets');
      const sheetNumber = `LS-${String(countRows[0].total + 1).padStart(5, '0')}`;

      const [result] = await connection.query(
        "INSERT INTO loading_sheets (sheet_number, driver_id, vehicle_id, status, created_by, notes) VALUES (?, ?, ?, 'assigned', ?, ?)",
        [sheetNumber, driver_id, vehicle_id, req.user?.id || null, notes || null]
      );
      const loadingSheetId = result.insertId;

      const assignedAt = new Date();
      for (const orderId of order_ids) {
        await connection.query(
          'INSERT INTO loading_sheet_orders (loading_sheet_id, sales_order_id) VALUES (?, ?)',
          [loadingSheetId, orderId]
        );
        await connection.query(
          "UPDATE sales_orders SET driver_id = ?, vehicle_id = ?, assigned_at = ?, status = 'assigned' WHERE id = ?",
          [driver_id, vehicle_id, assignedAt, orderId]
        );
        await recordOrderAssigned(connection, orderId, req.user?.id, driver_id, vehicle_id);
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Loading sheet created successfully',
        data: {
          id: loadingSheetId,
          sheet_number: sheetNumber,
          driver_id,
          driver_name: driverRows[0].name,
          vehicle_id,
          vehicle_registration_number: vehicleRows[0].registration_number,
          order_ids,
          assigned_at: assignedAt
        }
      });
    } catch (error) {
      await connection.rollback();
      console.error('Error creating loading sheet:', error);
      res.status(500).json({ success: false, error: 'Failed to create loading sheet' });
    } finally {
      connection.release();
    }
  },

  // PATCH /api/financial/loading-sheet/:id/status
  updateStatus: async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [sheets] = await connection.query('SELECT id, status FROM loading_sheets WHERE id = ?', [id]);
      if (sheets.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: 'Loading sheet not found' });
      }
      const currentStatus = sheets[0].status;

      if (TERMINAL_STATUSES.includes(currentStatus)) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `Loading sheet is already ${currentStatus} and cannot be updated` });
      }
      if (currentStatus === status) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `Loading sheet is already ${status}` });
      }

      await connection.query('UPDATE loading_sheets SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);

      const [orderLinks] = await connection.query(
        'SELECT sales_order_id FROM loading_sheet_orders WHERE loading_sheet_id = ?',
        [id]
      );
      const orderIds = orderLinks.map(o => o.sales_order_id);

      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        if (status === 'in_transit') {
          await connection.query(
            `UPDATE sales_orders SET status = 'shipped', my_status = 2, updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (3, 4, 5)`,
            orderIds
          );
        } else if (status === 'delivered') {
          const [eligible] = await connection.query(
            `SELECT id FROM sales_orders WHERE id IN (${placeholders}) AND my_status NOT IN (4, 5)`,
            orderIds
          );
          await connection.query(
            `UPDATE sales_orders SET status = 'delivered', my_status = 3, delivered_at = NOW(), updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (4, 5)`,
            orderIds
          );
          for (const o of eligible) {
            await recordOrderDelivered(connection, o.id, req.user?.id);
          }
        } else if (status === 'cancelled') {
          const [eligible] = await connection.query(
            `SELECT id FROM sales_orders WHERE id IN (${placeholders}) AND my_status NOT IN (3)`,
            orderIds
          );
          await connection.query(
            `UPDATE sales_orders SET status = 'cancelled', my_status = 4, cancel_reason = COALESCE(?, cancel_reason), updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (3)`,
            [reason || null, ...orderIds]
          );
          for (const o of eligible) {
            await recordOrderCancelled(connection, o.id, req.user?.id, reason);
          }
        }
      }

      await connection.commit();
      res.json({ success: true, message: `Loading sheet marked as ${status}`, data: { id: Number(id), status } });
    } catch (error) {
      await connection.rollback();
      console.error('Error updating loading sheet status:', error);
      res.status(500).json({ success: false, error: 'Failed to update loading sheet status' });
    } finally {
      connection.release();
    }
  },

  // PATCH /api/financial/loading-sheet/:id/orders/:orderId/status
  updateOrderStatus: async (req, res) => {
    const { id, orderId } = req.params;
    const { status, reason } = req.body;

    if (!ORDER_STATUS_MAP[status]) {
      return res.status(400).json({ success: false, error: 'status must be one of: in_transit, delivered, cancelled' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [links] = await connection.query(
        'SELECT sales_order_id FROM loading_sheet_orders WHERE loading_sheet_id = ? AND sales_order_id = ?',
        [id, orderId]
      );
      if (links.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: 'Order not found on this loading sheet' });
      }

      const [orderRows] = await connection.query('SELECT id, my_status FROM sales_orders WHERE id = ?', [orderId]);
      if (orderRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      const currentMyStatus = orderRows[0].my_status;
      if ([3, 4, 5].includes(currentMyStatus)) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'This order has already reached a final status and cannot be updated' });
      }

      const target = ORDER_STATUS_MAP[status];
      if (status === 'cancelled') {
        await connection.query(
          'UPDATE sales_orders SET status = ?, my_status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = NOW() WHERE id = ?',
          [target.status, target.my_status, reason || null, orderId]
        );
        await recordOrderCancelled(connection, orderId, req.user?.id, reason);
      } else if (status === 'delivered') {
        await connection.query(
          'UPDATE sales_orders SET status = ?, my_status = ?, delivered_at = NOW(), updated_at = NOW() WHERE id = ?',
          [target.status, target.my_status, orderId]
        );
        await recordOrderDelivered(connection, orderId, req.user?.id);
      } else {
        await connection.query(
          'UPDATE sales_orders SET status = ?, my_status = ?, updated_at = NOW() WHERE id = ?',
          [target.status, target.my_status, orderId]
        );
      }

      await autoCloseSheetIfComplete(connection, id);

      await connection.commit();
      res.json({ success: true, message: `Order marked as ${status}`, data: { id: Number(orderId), status: target.status, my_status: target.my_status } });
    } catch (error) {
      await connection.rollback();
      console.error('Error updating order status:', error);
      res.status(500).json({ success: false, error: 'Failed to update order status' });
    } finally {
      connection.release();
    }
  },

  // PATCH /api/financial/loading-sheet/:id/orders/status
  // Bulk-update the status of a selected subset of orders on the sheet
  updateSelectedOrdersStatus: async (req, res) => {
    const { id } = req.params;
    const { order_ids, status, reason } = req.body;

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one order must be selected' });
    }
    if (!ORDER_STATUS_MAP[status]) {
      return res.status(400).json({ success: false, error: 'status must be one of: in_transit, delivered, cancelled' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const placeholders = order_ids.map(() => '?').join(',');
      const [links] = await connection.query(
        `SELECT sales_order_id FROM loading_sheet_orders WHERE loading_sheet_id = ? AND sales_order_id IN (${placeholders})`,
        [id, ...order_ids]
      );
      if (links.length !== order_ids.length) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'One or more selected orders do not belong to this loading sheet' });
      }

      const target = ORDER_STATUS_MAP[status];
      let result;
      if (status === 'cancelled') {
        const [eligible] = await connection.query(
          `SELECT id FROM sales_orders WHERE id IN (${placeholders}) AND my_status NOT IN (3)`,
          order_ids
        );
        [result] = await connection.query(
          `UPDATE sales_orders SET status = ?, my_status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (3)`,
          [target.status, target.my_status, reason || null, ...order_ids]
        );
        for (const o of eligible) {
          await recordOrderCancelled(connection, o.id, req.user?.id, reason);
        }
      } else if (status === 'delivered') {
        const [eligible] = await connection.query(
          `SELECT id FROM sales_orders WHERE id IN (${placeholders}) AND my_status NOT IN (4, 5)`,
          order_ids
        );
        [result] = await connection.query(
          `UPDATE sales_orders SET status = ?, my_status = ?, delivered_at = NOW(), updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (4, 5)`,
          [target.status, target.my_status, ...order_ids]
        );
        for (const o of eligible) {
          await recordOrderDelivered(connection, o.id, req.user?.id);
        }
      } else {
        [result] = await connection.query(
          `UPDATE sales_orders SET status = ?, my_status = ?, updated_at = NOW() WHERE id IN (${placeholders}) AND my_status NOT IN (3, 4, 5)`,
          [target.status, target.my_status, ...order_ids]
        );
      }

      await autoCloseSheetIfComplete(connection, id);

      await connection.commit();
      res.json({
        success: true,
        message: `${result.affectedRows} order(s) marked as ${status}`,
        data: { status: target.status, my_status: target.my_status, updated_count: result.affectedRows }
      });
    } catch (error) {
      await connection.rollback();
      console.error('Error bulk-updating order status:', error);
      res.status(500).json({ success: false, error: 'Failed to update selected orders' });
    } finally {
      connection.release();
    }
  }
};

module.exports = loadingSheetController;
