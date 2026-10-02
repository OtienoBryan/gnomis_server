-- Migration: stock receipts (the history of products received into a store)
CREATE TABLE IF NOT EXISTS stock_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(255) NOT NULL,
  store_id INT NOT NULL,
  received_by INT NULL,
  notes TEXT NULL,
  total_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_receipts_store (store_id),
  INDEX idx_stock_receipts_created (created_at)
);

CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  INDEX idx_stock_receipt_items_receipt (receipt_id),
  CONSTRAINT fk_stock_receipt_items_receipt FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id) ON DELETE CASCADE
);
