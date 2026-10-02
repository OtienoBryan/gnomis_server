-- Migration: requests for raw materials for processing (production)
CREATE TABLE IF NOT EXISTS raw_material_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_number VARCHAR(30) NOT NULL,
  status ENUM('pending', 'approved', 'issued', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  requested_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rmr_number (request_number),
  INDEX idx_rmr_status (status)
);

-- Products to be made and the quantity targeted
CREATE TABLE IF NOT EXISTS raw_material_request_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  INDEX idx_rmrp_request (request_id),
  CONSTRAINT fk_rmrp_request FOREIGN KEY (request_id) REFERENCES raw_material_requests(id) ON DELETE CASCADE
);

-- Raw materials requested and their quantities
CREATE TABLE IF NOT EXISTS raw_material_request_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  raw_material_id INT NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  INDEX idx_rmri_request (request_id),
  CONSTRAINT fk_rmri_request FOREIGN KEY (request_id) REFERENCES raw_material_requests(id) ON DELETE CASCADE
);
