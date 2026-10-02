-- The stores table was missing columns that storeController.js already expected
-- (location, phone, email, updated_at), causing create/update store requests to fail.
ALTER TABLE stores
  ADD COLUMN location VARCHAR(150) NULL AFTER store_name,
  ADD COLUMN phone VARCHAR(20) NULL AFTER address,
  ADD COLUMN email VARCHAR(150) NULL AFTER phone,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
