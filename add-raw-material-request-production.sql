-- Migration: confirming production for issued raw material requests
ALTER TABLE raw_material_requests
  MODIFY status ENUM('pending', 'approved', 'issued', 'completed', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  ADD COLUMN completed_by INT NULL,
  ADD COLUMN completed_at DATETIME NULL,
  ADD COLUMN production_note TEXT NULL;

ALTER TABLE raw_material_request_products
  ADD COLUMN produced_quantity DECIMAL(12,2) NULL;

ALTER TABLE raw_material_request_items
  ADD COLUMN used_quantity DECIMAL(12,3) NULL,
  ADD COLUMN returned_quantity DECIMAL(12,3) NULL;
