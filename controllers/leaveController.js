const db = require('../database/db');

exports.getAllSalesRepLeaves = async (req, res) => {
  console.log('GET /api/sales-rep-leaves called');
  const { team_leader_id } = req.query;
  
  // Build WHERE clause for team leader filtering
  let whereClause = '';
  const params = [];
  if (team_leader_id) {
    whereClause = 'WHERE sr.leader_id = ?';
    params.push(team_leader_id);
  }
  
  const sql = `
    SELECT 
      lr.id,
      COALESCE(sr.id, lr.employee_id) as userId,
      COALESCE(sr.name, CONCAT('Sales Rep ', lr.employee_id)) as userName,
      COALESCE(lt.name, 'Unknown') as leaveType,
      lr.start_date as startDate,
      lr.end_date as endDate,
      lr.reason,
      lr.attachment_url as attachment,
      CAST(lr.status AS UNSIGNED) as status,
      lr.team_leader_approved_by as teamLeaderApprovedById,
      COALESCE(tl.username, tl.email) as teamLeaderApprovedBy,
      lr.team_leader_approved_at as teamLeaderApprovedAt,
      lr.created_at as createdAt,
      lr.updated_at as updatedAt
    FROM leave_requests lr
    LEFT JOIN SalesRep sr ON lr.employee_id = sr.id
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    LEFT JOIN users tl ON lr.team_leader_approved_by = tl.id
    ${whereClause}
    ORDER BY lr.id DESC
  `;
  console.log('SQL:', sql);
  console.log('Team leader ID filter:', team_leader_id);
  console.log('Query params:', params);
  try {
    const [rows] = await db.query(sql, params);
    console.log('Rows fetched:', rows.length);
    
    // Convert status to integer for each row
    const processedRows = rows.map(row => ({
      ...row,
      status: typeof row.status === 'string' ? parseInt(row.status, 10) : row.status
    }));
    
    // Log a sample row to debug
    if (processedRows.length > 0) {
      console.log('Sample row:', JSON.stringify(processedRows[0], null, 2));
    }
    res.json(processedRows);
  } catch (err) {
    console.error('Error fetching sales rep leaves:', err);
    res.status(500).json({ error: 'Failed to fetch sales rep leaves', details: err.message });
  }
};

exports.updateLeaveStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  console.log(`PATCH /api/sales-rep-leaves/${id}/status called with status:`, status);
  console.log('Request body:', req.body);
  console.log('Request params:', req.params);
  
  // Convert status to integer (status column is tinyint, not ENUM)
  let statusValue;
  if (status === 0 || status === '0') {
    statusValue = 0; // pending
  } else if (status === 1 || status === '1') {
    statusValue = 1; // approved
  } else if (status === 7 || status === '7') {
    statusValue = 7; // approved by team leader
  } else if (status === 2 || status === '2') {
    statusValue = 2; // declined/rejected
  } else {
    console.log('Invalid status value:', status);
    return res.status(400).json({ error: 'Invalid status value. Must be 0 (pending), 1 (approved), 2 (declined), or 7 (team leader approved)' });
  }
  
  console.log('Status value (integer):', statusValue, 'Type:', typeof statusValue);
  
  try {
    // First check if the leave exists
    const [checkResult] = await db.query('SELECT * FROM leave_requests WHERE id = ?', [id]);
    console.log('Leave found:', checkResult.length > 0);
    if (checkResult.length === 0) {
      console.log('Leave not found with id:', id);
      return res.status(404).json({ error: 'Leave not found' });
    }
    console.log('Current leave status before update:', checkResult[0].status);
    
    // Update the leave_requests table
    console.log('Preparing to update leave_requests table');
    console.log('Status value:', statusValue, 'Type:', typeof statusValue);
    console.log('Leave ID:', id, 'Type:', typeof id);
    
    // Ensure id is a number
    const leaveId = parseInt(id, 10);
    if (isNaN(leaveId)) {
      console.error('Invalid leave ID:', id);
      return res.status(400).json({ error: 'Invalid leave ID' });
    }
    
    // Execute the update query
    const updateQuery = `
      UPDATE leave_requests 
      SET 
        status = ?,
        team_leader_approved_by = CASE WHEN ? = 7 THEN ? ELSE NULL END,
        team_leader_approved_at = CASE WHEN ? = 7 THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `;
    console.log('Executing UPDATE query:', updateQuery);
    console.log('Parameters:', [statusValue, statusValue, req.user?.id || null, statusValue, leaveId]);
    
    const [result] = await db.query(updateQuery, [statusValue, statusValue, req.user?.id || null, statusValue, leaveId]);
    
    console.log('Update result - affectedRows:', result?.affectedRows);
    console.log('Update result - changedRows:', result?.changedRows);
    console.log('Update result - warningCount:', result?.warningCount);
    
    const affectedRows = result?.affectedRows || 0;
    
    if (affectedRows === 0) {
      console.error('UPDATE query returned 0 affected rows');
      // Verify the record exists
      const [verify] = await db.query('SELECT id, status, employee_id FROM leave_requests WHERE id = ?', [leaveId]);
      console.log('Verification query result:', verify);
      if (verify.length === 0) {
        return res.status(404).json({ error: 'Leave not found' });
      } else {
        console.error('Leave exists but update did not affect any rows');
        console.error('Current status:', verify[0].status);
        return res.status(500).json({ error: 'Update query executed but did not affect any rows' });
      }
    }
    
    // Check for MySQL warnings
    const warningCount = result?.warningCount || 0;
    if (warningCount > 0) {
      console.warn('MySQL warnings detected. Warning count:', warningCount);
    }
    
    // Immediately verify the update by fetching the updated record
    console.log('Fetching updated record to verify...');
    const [updatedLeave] = await db.query(`
      SELECT 
        lr.id,
        lr.status as db_status,
        lr.updated_at
      FROM leave_requests lr
      WHERE lr.id = ?
    `, [leaveId]);
    
    if (updatedLeave.length === 0) {
      console.error('Could not fetch updated leave record after update');
      return res.status(500).json({ error: 'Status update reported success but record not found' });
    }
    
    console.log(`Leave ${leaveId} verification after update:`);
    console.log('Database status value:', updatedLeave[0].db_status, 'Type:', typeof updatedLeave[0].db_status);
    console.log('Expected status value:', statusValue, 'Type:', typeof statusValue);
    console.log('Updated timestamp:', updatedLeave[0].updated_at);
    
    // Verify the status was actually updated (compare as numbers)
    const dbStatus = Number(updatedLeave[0].db_status);
    const expectedStatus = Number(statusValue);
    
    console.log('Status comparison - DB:', dbStatus, 'Expected:', expectedStatus);
    
    if (dbStatus !== expectedStatus) {
      console.error('CRITICAL: Status mismatch after update!');
      console.error('Expected:', expectedStatus, 'Got:', dbStatus);
      console.error('This indicates the UPDATE query did not actually change the status in the database.');
      return res.status(500).json({ 
        error: 'Status update failed - database status does not match expected value',
        details: {
          expected: statusValue,
          actual: updatedLeave[0].db_status,
          affectedRows: affectedRows
        }
      });
    } else {
      console.log('✓ Status verification successful! Status was updated correctly.');
    }
    
    res.json({ 
      success: true, 
      message: 'Leave status updated successfully in leave_requests table',
      status: updatedLeave[0].db_status
    });
  } catch (err) {
    console.error('Error updating leave status:', err);
    console.error('Error details:', err.message);
    res.status(500).json({ error: 'Failed to update leave status', details: err.message });
  }
}; 