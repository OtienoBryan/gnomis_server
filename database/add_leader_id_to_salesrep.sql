-- Add leader_id column to SalesRep table
-- This column stores the team leader ID for each sales rep
-- Note: This will fail if the column already exists, which is expected behavior

-- Add leader_id column (will fail silently if column exists)
ALTER TABLE SalesRep 
ADD COLUMN leader_id INT NULL;

-- Add foreign key constraint to reference SalesRep (team leaders)
-- Note: This will fail if constraint already exists, which is expected
ALTER TABLE SalesRep 
ADD CONSTRAINT fk_salesrep_leader 
FOREIGN KEY (leader_id) REFERENCES SalesRep(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX idx_salesrep_leader_id ON SalesRep(leader_id);
