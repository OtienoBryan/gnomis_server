-- Master SKUs + one SKU per product
-- Run this on the same DB used by the app (see DB_NAME in server/.env).

CREATE TABLE IF NOT EXISTS skus (
  id INT NOT NULL AUTO_INCREMENT,
  sku VARCHAR(128) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skus_sku (sku)
);

-- Add one SKU per product (nullable)
ALTER TABLE products
  ADD COLUMN sku_id INT NULL,
  ADD KEY idx_products_sku_id (sku_id),
  ADD CONSTRAINT fk_products_sku_id
    FOREIGN KEY (sku_id) REFERENCES skus(id)
    ON DELETE SET NULL;

