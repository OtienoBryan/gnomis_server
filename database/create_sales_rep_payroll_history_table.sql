-- Payroll run history for Sales Reps (separate from staff payroll_history, since
-- SalesRep and staff are distinct tables with independent id spaces).
CREATE TABLE IF NOT EXISTS sales_rep_payroll_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sales_rep_id INT NOT NULL,
    pay_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    basic_salary DECIMAL(15,2) NOT NULL DEFAULT 0,
    working_days INT NOT NULL DEFAULT 0,
    days_paid INT NOT NULL DEFAULT 0,
    gross_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(15,2) NOT NULL DEFAULT 0,
    net_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
    journal_entry_id INT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sales_rep_id) REFERENCES SalesRep(id),
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id),
    UNIQUE KEY unique_rep_pay_date (sales_rep_id, pay_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
