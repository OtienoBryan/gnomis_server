// Shared helpers for keeping the order_details audit table in sync with a
// sales order's lifecycle (created, approved, assigned, delivered, cancelled).
// Each function upserts so it works even for orders created before this table
// existed. All take a `connection` (or the plain db pool) so callers can run
// them inside an existing transaction.

const recordOrderCreated = async (connection, orderId, userId) => {
  await connection.query(`
    INSERT INTO order_details (order_id, created_at, created_by)
    VALUES (?, NOW(), ?)
    ON DUPLICATE KEY UPDATE created_by = COALESCE(created_by, ?)
  `, [orderId, userId || null, userId || null]);
};

const recordOrderApproved = async (connection, orderId, userId) => {
  await connection.query(`
    INSERT INTO order_details (order_id, created_at, approved_at, approved_by)
    VALUES (?, NOW(), NOW(), ?)
    ON DUPLICATE KEY UPDATE
      approved_at = COALESCE(approved_at, NOW()),
      approved_by = COALESCE(approved_by, ?)
  `, [orderId, userId || null, userId || null]);
};

const recordOrderAssigned = async (connection, orderId, userId, driverId, vehicleId) => {
  await connection.query(`
    INSERT INTO order_details (order_id, created_at, assigned_at, assigned_by, driver_id, vehicle_id)
    VALUES (?, NOW(), NOW(), ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      assigned_at = NOW(),
      assigned_by = ?,
      driver_id = ?,
      vehicle_id = ?
  `, [orderId, userId || null, driverId || null, vehicleId || null, userId || null, driverId || null, vehicleId || null]);
};

const recordOrderDelivered = async (connection, orderId, userId) => {
  await connection.query(`
    INSERT INTO order_details (order_id, created_at, delivered_at, delivered_by)
    VALUES (?, NOW(), NOW(), ?)
    ON DUPLICATE KEY UPDATE
      delivered_at = COALESCE(delivered_at, NOW()),
      delivered_by = COALESCE(delivered_by, ?)
  `, [orderId, userId || null, userId || null]);
};

const recordOrderCancelled = async (connection, orderId, userId, reason) => {
  await connection.query(`
    INSERT INTO order_details (order_id, created_at, cancelled_at, cancelled_by, cancel_reason)
    VALUES (?, NOW(), NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE
      cancelled_at = COALESCE(cancelled_at, NOW()),
      cancelled_by = COALESCE(cancelled_by, ?),
      cancel_reason = COALESCE(cancel_reason, ?)
  `, [orderId, userId || null, reason || null, userId || null, reason || null]);
};

module.exports = {
  recordOrderCreated,
  recordOrderApproved,
  recordOrderAssigned,
  recordOrderDelivered,
  recordOrderCancelled
};
