-- Product Brand Table Schema
-- This table stores product brands

CREATE TABLE IF NOT EXISTS Brand (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_brand_name (name),
    INDEX idx_brand_active (is_active)
);

-- Add brand_id to products table if it doesn't exist
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS brand_id INT NULL,
ADD INDEX IF NOT EXISTS idx_product_brand (brand_id);

-- Add foreign key constraint
ALTER TABLE products
ADD CONSTRAINT fk_product_brand 
FOREIGN KEY (brand_id) REFERENCES Brand(id) 
ON DELETE SET NULL 
ON UPDATE CASCADE;
