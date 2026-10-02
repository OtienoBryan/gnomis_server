-- Migration: allow purchase order items to reference a raw material instead of a product
ALTER TABLE purchase_order_items
  MODIFY product_id INT NULL,
  ADD COLUMN raw_material_id INT NULL AFTER product_id,
  ADD INDEX idx_poi_raw_material (raw_material_id);
