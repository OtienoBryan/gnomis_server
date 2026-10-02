-- Migration: type of store (storage or sales van)
ALTER TABLE stores
  ADD COLUMN store_type VARCHAR(20) NOT NULL DEFAULT 'storage' AFTER store_code;
