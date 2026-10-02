-- Migration: raw material ledger (stock movements)
CREATE TABLE IF NOT EXISTS raw_material_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  raw_material_id INT NOT NULL,
  transaction_date DATE NOT NULL,
  type ENUM('in', 'out') NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  reference VARCHAR(255) NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rmt_material_date (raw_material_id, transaction_date),
  CONSTRAINT fk_rmt_raw_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE
);
