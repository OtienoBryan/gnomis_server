-- Migration: track raw material stock per store
-- Existing ledger rows keep store_id NULL and are reported as "unassigned".
ALTER TABLE raw_material_transactions
ADD COLUMN IF NOT EXISTS store_id INT NULL AFTER raw_material_id,
ADD INDEX idx_rmt_store (store_id);
