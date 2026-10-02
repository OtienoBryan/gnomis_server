-- Brand SOS (Share of Shelf) Targets Table Schema
CREATE TABLE IF NOT EXISTS brand_sos_targets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    outlet_account_id INT NOT NULL,
    brand_id INT NOT NULL,
    target_percentage DECIMAL(5,2) NOT NULL CHECK (target_percentage >= 0 AND target_percentage <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_outlet_brand (outlet_account_id, brand_id),
    INDEX idx_outlet_account (outlet_account_id),
    INDEX idx_brand (brand_id),
    FOREIGN KEY (outlet_account_id) REFERENCES outlet_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id) REFERENCES Brand(id) ON DELETE CASCADE
);
