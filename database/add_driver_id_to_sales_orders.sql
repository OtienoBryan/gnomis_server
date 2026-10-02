-- Allows assigning a driver (a staff member with role = 'driver') to a confirmed
-- sales order, separate from the existing Riders-based rider dispatch workflow.
ALTER TABLE sales_orders
  ADD COLUMN driver_id INT NULL AFTER rider_id;
