-- Petty cash allocation to sales reps (also created automatically on first use)
ALTER TABLE SalesRep ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS petty_cash_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sales_rep_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  allocation_date DATE NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  reference VARCHAR(100) NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_by_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pca_rep (sales_rep_id)
);

-- credit = cash given to the rep (increases balance), debit = cash spent/returned (decreases it)
CREATE TABLE IF NOT EXISTS sales_rep_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sales_rep_id INT NOT NULL,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  reference_type VARCHAR(30) NOT NULL,
  reference_id INT NOT NULL,
  payment_method VARCHAR(30) NULL,
  reference VARCHAR(100) NULL,
  debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  running_balance DECIMAL(15,2) NOT NULL,
  created_by INT NULL,
  created_by_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_srl_rep (sales_rep_id, date)
);
