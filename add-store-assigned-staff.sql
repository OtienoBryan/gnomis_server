-- Migration: staff assigned to a store (used for sales vans)
ALTER TABLE stores
  ADD COLUMN assigned_staff_id INT NULL AFTER store_type;
