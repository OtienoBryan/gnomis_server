-- The assets table lost its account_id, purchase_date, and purchase_value columns
-- at some point, breaking the dashboard stats query and the wider Assets/Balance
-- Sheet/Depreciation module (financialController.js, reportsController.js all
-- expect these columns). assets_backup retains the original data for all rows,
-- so restore the columns and repopulate them from it.
ALTER TABLE assets
  ADD COLUMN account_id INT NULL AFTER id,
  ADD COLUMN purchase_date DATE NULL AFTER name,
  ADD COLUMN purchase_value DECIMAL(15,2) NULL AFTER purchase_date;

UPDATE assets a
JOIN assets_backup b ON a.id = b.id
SET a.account_id = b.account_id,
    a.purchase_date = b.purchase_date,
    a.purchase_value = b.purchase_value;
