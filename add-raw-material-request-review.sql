-- Migration: approving / declining raw material requests
ALTER TABLE raw_material_requests
  ADD COLUMN store_id INT NULL AFTER notes,
  ADD COLUMN reviewed_by INT NULL AFTER requested_by,
  ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
  ADD COLUMN review_note TEXT NULL AFTER reviewed_at;

-- Requests allow 3 decimals (recipe quantities), so the ledger must keep them too
ALTER TABLE raw_material_transactions MODIFY quantity DECIMAL(12,3) NOT NULL;
