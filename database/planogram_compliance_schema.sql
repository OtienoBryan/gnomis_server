-- Planogram Compliance Table Schema
-- Stores planogram compliance quantity per product per outlet account
CREATE TABLE IF NOT EXISTS planogram_compliance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    outlet_account_id INT NOT NULL,
    product_id INT NOT NULL,
    compliance_quantity INT NOT NULL CHECK (compliance_quantity >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_outlet_product (outlet_account_id, product_id),
    INDEX idx_outlet_account (outlet_account_id),
    INDEX idx_product (product_id),
    FOREIGN KEY (outlet_account_id) REFERENCES outlet_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
