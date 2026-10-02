-- Product SKUs table
-- Run this on the same DB used by the app (see DB_NAME in server/.env).

CREATE TABLE IF NOT EXISTS product_skus (
  id INT NOT NULL AUTO_INCREMENT,
  product_id INT NOT NULL,
  sku VARCHAR(128) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_sku (product_id, sku),
  KEY idx_product_skus_product_id (product_id),
  CONSTRAINT fk_product_skus_product_id
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE
);

