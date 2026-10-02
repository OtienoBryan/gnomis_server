-- Create sales_rep_team_leaders table for assigning team leaders to sales reps
-- Team leaders are sales reps with role = 'team leader'
CREATE TABLE IF NOT EXISTS sales_rep_team_leaders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sales_rep_id INT NOT NULL,
  team_leader_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_sales_rep_team_leader (sales_rep_id, team_leader_id),
  FOREIGN KEY (sales_rep_id) REFERENCES SalesRep(id) ON DELETE CASCADE,
  FOREIGN KEY (team_leader_id) REFERENCES SalesRep(id) ON DELETE CASCADE,
  INDEX idx_sales_rep_id (sales_rep_id),
  INDEX idx_team_leader_id (team_leader_id)
);
