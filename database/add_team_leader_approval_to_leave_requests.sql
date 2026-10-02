-- Add columns to track team leader approval metadata on leave requests
ALTER TABLE leave_requests
  ADD COLUMN team_leader_approved_by INT NULL AFTER approved_by,
  ADD COLUMN team_leader_approved_at DATETIME NULL AFTER team_leader_approved_by;

-- Optional foreign key to users table for approver id
ALTER TABLE leave_requests
  ADD CONSTRAINT fk_leave_requests_team_leader_approved_by
  FOREIGN KEY (team_leader_approved_by) REFERENCES users(id)
  ON DELETE SET NULL;

-- Helpful index for reporting/filtering by approving team leader
ALTER TABLE leave_requests
  ADD INDEX idx_leave_requests_team_leader_approved_by (team_leader_approved_by);
