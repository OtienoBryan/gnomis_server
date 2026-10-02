-- Migration: add outer_qty and price_per_pack columns to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS outer_qty INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS price_per_pack DECIMAL(10,2) DEFAULT 0;
