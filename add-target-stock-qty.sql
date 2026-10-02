-- Migration: add target_stock_qty column to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS target_stock_qty INT DEFAULT 0;
