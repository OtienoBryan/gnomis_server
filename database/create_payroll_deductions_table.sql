-- Payroll Deductions: configurable statutory/other deductions (e.g. PAYE, NSSF, NHIF)
-- Each deduction is linked to a liability account in chart_of_accounts (account_type = 10, Current Liability)
CREATE TABLE IF NOT EXISTS payroll_deductions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NULL,
    calculation_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'fixed',
    rate DECIMAL(10,4) NULL,        -- used when calculation_type = 'percentage' (e.g. 6.0000 for 6%)
    amount DECIMAL(10,2) NULL,      -- used when calculation_type = 'fixed'
    cap_amount DECIMAL(10,2) NULL,  -- optional maximum deduction amount
    account_id INT NOT NULL,        -- chart_of_accounts.id where account_type = 10
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);
