const db = require('../database/db');

const journeyPlanController = {
  // Get route compliance summary per sales rep
  getRouteCompliance: async (req, res) => {
    try {
      const { startDate, endDate, country } = req.query;

      const dateParams = [];
      const dateFilter = [];
      if (startDate && endDate) {
        dateFilter.push('DATE(jp.date) BETWEEN ? AND ?');
        dateParams.push(startDate, endDate);
      } else if (startDate) {
        dateFilter.push('DATE(jp.date) >= ?');
        dateParams.push(startDate);
      } else if (endDate) {
        dateFilter.push('DATE(jp.date) <= ?');
        dateParams.push(endDate);
      }

      const whereClause = dateFilter.length ? `WHERE ${dateFilter.join(' AND ')}` : '';
      
      // Add country filter to WHERE clause for SalesRep
      let countryFilter = '';
      const allParams = [];
      if (country) {
        countryFilter = 'sr.country = ?';
        allParams.push(country);
      }
      
      const sql = `
        SELECT 
          sr.id AS salesRepId,
          sr.name AS salesRepName,
          COALESCE(COUNT(jp.id), 0) AS plannedVisits,
          COALESCE(SUM(CASE 
            WHEN jp.checkInTime IS NOT NULL OR jp.status IN (1,2) THEN 1 
            ELSE 0 
          END), 0) AS achievedVisits
        FROM SalesRep sr
        LEFT JOIN JourneyPlan jp 
          ON sr.id = jp.userId
          ${whereClause ? `AND ${dateFilter.join(' AND ')}` : ''}
        WHERE sr.status = 1
        ${countryFilter ? `AND ${countryFilter}` : ''}
        GROUP BY sr.id, sr.name
        ORDER BY sr.name ASC
      `;

      // Combine params: date params (for JOIN ON clause) + country param (for WHERE clause)
      const queryParams = [...dateParams, ...allParams];

      const [rows] = await db.query(sql, queryParams);

      const data = rows.map(r => {
        const planned = Number(r.plannedVisits) || 0;
        const achieved = Number(r.achievedVisits) || 0;
        const compliancePct = planned > 0 ? Number(((achieved / planned) * 100).toFixed(1)) : 0;
        return {
          salesRepId: r.salesRepId,
          salesRepName: r.salesRepName,
          plannedVisits: planned,
          achievedVisits: achieved,
          compliancePct
        };
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Get route compliance error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch route compliance', error: error.message });
    }
  },
  // Get all journey plans (with optional date, country, team_leader_id filtering, and limit)
  getAllJourneyPlans: async (req, res) => {
    try {
      const { startDate, endDate, country, limit, team_leader_id, status, region } = req.query;
      const limitValue = limit ? parseInt(limit, 10) : null;

      // Build SQL query with JOIN to SalesRep for country and team leader filtering
      let sql = `
        SELECT 
          jp.id,
          jp.date,
          jp.time,
          jp.userId,
          jp.clientId,
          jp.status,
          jp.checkInTime,
          jp.latitude,
          jp.longitude,
          jp.imageUrl,
          jp.notes,
          jp.checkoutLatitude,
          jp.checkoutLongitude,
          jp.checkoutTime,
          jp.showUpdateLocation,
          jp.routeId,
          sr.name as user_name,
          sr.country as sales_rep_country,
          sr.region as region_name,
          sr.role as user_role,
          c.name as client_name,
          COALESCE(r_route.name, c_route.name, sr_route.name) as route_name
        FROM JourneyPlan jp
        LEFT JOIN SalesRep sr ON jp.userId = sr.id
        LEFT JOIN Clients c ON jp.clientId = c.id
        LEFT JOIN routes r_route ON jp.routeId = r_route.id
        LEFT JOIN routes c_route ON c.route_id_update = c_route.id
        LEFT JOIN routes sr_route ON sr.route_id_update = sr_route.id
      `;
      const params = [];
      const where = [];
      
      // Date filtering
      if (startDate && endDate) {
        where.push('DATE(jp.date) BETWEEN ? AND ?');
        params.push(startDate, endDate);
      } else if (startDate) {
        where.push('DATE(jp.date) >= ?');
        params.push(startDate);
      } else if (endDate) {
        where.push('DATE(jp.date) <= ?');
        params.push(endDate);
      }
      
      // Country filtering (deprecated for activity page; keep for compatibility)
      if (country) {
        where.push('sr.country = ?');
        params.push(country);
      }

      // Status filtering
      if (status !== undefined && status !== '') {
        where.push('jp.status = ?');
        params.push(Number(status));
      }

      // Region filtering
      if (region) {
        where.push('sr.region = ?');
        params.push(region);
      }
      
      // Team leader filtering - only show journey plans for sales reps assigned to this team leader
      const effectiveTeamLeaderId = team_leader_id || (req.user && req.user.role === 'leader' ? req.user.id : null);
      if (effectiveTeamLeaderId) {
        where.push('sr.leader_id = ?');
        params.push(effectiveTeamLeaderId);
      }
      
      if (where.length) {
        sql += ' WHERE ' + where.join(' AND ');
      }
      sql += ' ORDER BY jp.date DESC';
      
      // Add LIMIT for performance optimization (use parameterized query for safety)
      if (limitValue && limitValue > 0 && limitValue <= 1000) {
        sql += ' LIMIT ?';
        params.push(limitValue);
      }

      const [plans] = await db.query(sql, params);
      
      res.json(plans);
    } catch (error) {
      console.error('Get all journey plans error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch journey plans', error: error.message });
    }
  },

  // Get journey plans by user ID
  getJourneyPlansByUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const [plans] = await db.query(`
        SELECT jp.*, 
               c.name as client_name,
               c.address as client_address,
               r.name as route_name
        FROM JourneyPlan jp
        LEFT JOIN Clients c ON jp.clientId = c.id
        LEFT JOIN routes r ON jp.routeId = r.id
        WHERE jp.userId = ?
        ORDER BY jp.date ASC, jp.time ASC
      `, [userId]);
      
      res.json(plans);
    } catch (error) {
      console.error('Get journey plans by user error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch journey plans', error: error.message });
    }
  },

  // Get journey plan by ID
  getJourneyPlan: async (req, res) => {
    try {
      const { id } = req.params;
      const [plans] = await db.query(`
        SELECT jp.*, 
               s.name as user_name,
               c.name as client_name,
               c.address as client_address,
               c.email as client_email,
               c.contact as client_contact,
               r.name as route_name
        FROM JourneyPlan jp
        LEFT JOIN SalesRep s ON jp.userId = s.id
        LEFT JOIN Clients c ON jp.clientId = c.id
        LEFT JOIN routes r ON jp.routeId = r.id
        WHERE jp.id = ?
      `, [id]);
      
      if (plans.length === 0) {
        return res.status(404).json({ success: false, message: 'Journey plan not found' });
      }
      res.json(plans[0]);
    } catch (error) {
      console.error('Get journey plan error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch journey plans', error: error.message });
    }
  },

  // Create new journey plan
  createJourneyPlan: async (req, res) => {
    try {
      const {
        date,
        time,
        userId,
        clientId,
        status = 0,
        notes,
        showUpdateLocation = true,
        routeId,
        latitude,
        longitude,
        location_locked
      } = req.body;

      if (!date || !time || !userId || !clientId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Required fields missing: date, time, userId, clientId' 
        });
      }

      // Fetch location_locked from Clients table if not provided
      let finalLocationLocked = location_locked;
      if (finalLocationLocked === undefined || finalLocationLocked === null) {
        const [clientData] = await db.query(
          'SELECT location_locked FROM Clients WHERE id = ?',
          [clientId]
        );
        if (clientData.length > 0) {
          finalLocationLocked = clientData[0].location_locked || 0;
        } else {
          finalLocationLocked = 0;
        }
      }

      // Combine date and time into datetime
      const dateTime = `${date} ${time}:00`;

      const [result] = await db.query(`
        INSERT INTO JourneyPlan (
          date, time, userId, clientId, status, notes, 
          showUpdateLocation, routeId, latitude, longitude, location_locked, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [dateTime, time, userId, clientId, status, notes, showUpdateLocation, routeId, latitude, longitude, finalLocationLocked ? 1 : 0]);

      // Fetch the created journey plan
      const [newPlan] = await db.query(`
        SELECT jp.*, 
               u.name as user_name,
               c.name as client_name
        FROM JourneyPlan jp
        LEFT JOIN users u ON jp.userId = u.id
        LEFT JOIN Clients c ON jp.clientId = c.id
        WHERE jp.id = ?
      `, [result.insertId]);

      res.status(201).json({ 
        success: true, 
        message: 'Journey plan created successfully',
        data: newPlan[0]
      });
    } catch (error) {
      console.error('Create journey plan error:', error);
      res.status(500).json({ success: false, message: 'Failed to create journey plan', error: error.message });
    }
  },

  // Update journey plan
  updateJourneyPlan: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        date,
        time,
        status,
        notes,
        checkInTime,
        latitude,
        longitude,
        imageUrl,
        checkoutLatitude,
        checkoutLongitude,
        checkoutTime,
        showUpdateLocation,
        routeId
      } = req.body;

      // Build dynamic UPDATE query
      const updates = [];
      const values = [];

      if (date !== undefined) { updates.push('date = ?'); values.push(date); }
      if (time !== undefined) { updates.push('time = ?'); values.push(time); }
      if (status !== undefined) { updates.push('status = ?'); values.push(status); }
      if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
      if (checkInTime !== undefined) { updates.push('checkInTime = ?'); values.push(checkInTime); }
      if (latitude !== undefined) { updates.push('latitude = ?'); values.push(latitude); }
      if (longitude !== undefined) { updates.push('longitude = ?'); values.push(longitude); }
      if (imageUrl !== undefined) { updates.push('imageUrl = ?'); values.push(imageUrl); }
      if (checkoutLatitude !== undefined) { updates.push('checkoutLatitude = ?'); values.push(checkoutLatitude); }
      if (checkoutLongitude !== undefined) { updates.push('checkoutLongitude = ?'); values.push(checkoutLongitude); }
      if (checkoutTime !== undefined) { updates.push('checkoutTime = ?'); values.push(checkoutTime); }
      if (showUpdateLocation !== undefined) { updates.push('showUpdateLocation = ?'); values.push(showUpdateLocation); }
      if (routeId !== undefined) { updates.push('routeId = ?'); values.push(routeId); }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields provided for update' });
      }

      updates.push('updatedAt = NOW()');
      values.push(id);

      await db.query(
        `UPDATE JourneyPlan SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Fetch the updated journey plan
      const [updatedPlan] = await db.query(`
        SELECT jp.*, 
               u.name as user_name,
               c.name as client_name
        FROM JourneyPlan jp
        LEFT JOIN users u ON jp.userId = u.id
        LEFT JOIN Clients c ON jp.clientId = c.id
        WHERE jp.id = ?
      `, [id]);

      res.json({ 
        success: true, 
        message: 'Journey plan updated successfully',
        data: updatedPlan[0]
      });
    } catch (error) {
      console.error('Update journey plan error:', error);
      res.status(500).json({ success: false, message: 'Failed to update journey plan', error: error.message });
    }
  },

  // Delete journey plan
  deleteJourneyPlan: async (req, res) => {
    try {
      const { id } = req.params;
      
      const [result] = await db.query('DELETE FROM JourneyPlan WHERE id = ?', [id]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Journey plan not found' });
      }
      
      res.json({ success: true, message: 'Journey plan deleted successfully' });
    } catch (error) {
      console.error('Delete journey plan error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete journey plan', error: error.message });
    }
  },

  // Check in to a journey plan
  checkIn: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude, imageUrl, notes } = req.body;

      const updateData = {
        checkInTime: new Date().toISOString(),
        status: 1, // In Progress
        updatedAt: new Date().toISOString()
      };

      if (latitude !== undefined) updateData.latitude = latitude;
      if (longitude !== undefined) updateData.longitude = longitude;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      if (notes !== undefined) updateData.notes = notes;

      const updates = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
      const values = [...Object.values(updateData), id];

      await db.query(
        `UPDATE JourneyPlan SET ${updates} WHERE id = ?`,
        values
      );

      res.json({ success: true, message: 'Check-in successful' });
    } catch (error) {
      console.error('Check-in error:', error);
      res.status(500).json({ success: false, message: 'Failed to check-in', error: error.message });
    }
  },

  // Check out from a journey plan
  checkOut: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude, notes } = req.body;

      const updateData = {
        checkoutTime: new Date().toISOString(),
        status: 2, // Completed
        updatedAt: new Date().toISOString()
      };

      if (latitude !== undefined) updateData.checkoutLatitude = latitude;
      if (longitude !== undefined) updateData.checkoutLongitude = longitude;
      if (notes !== undefined) updateData.notes = notes;

      const updates = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
      const values = [...Object.values(updateData), id];

      await db.query(
        `UPDATE JourneyPlan SET ${updates} WHERE id = ?`,
        values
      );

      res.json({ success: true, message: 'Check-out successful' });
    } catch (error) {
      console.error('Check-out error:', error);
      res.status(500).json({ success: false, message: 'Failed to check-out', error: error.message });
    }
  },

  // Get outlet coverage by sales rep with weekly breakdown
  getOutletCoverage: async (req, res) => {
    try {
      const { month, year, country } = req.query;
      
      // Default to current month if not provided
      const now = new Date();
      const targetMonth = month ? parseInt(month) : now.getMonth() + 1;
      const targetYear = year ? parseInt(year) : now.getFullYear();
      
      // Calculate first and last day of the month
      const firstDay = new Date(targetYear, targetMonth - 1, 1);
      const lastDay = new Date(targetYear, targetMonth, 0);
      const startDate = firstDay.toISOString().split('T')[0];
      const endDate = lastDay.toISOString().split('T')[0];
      
      // Calculate week boundaries (5 weeks)
      const weeks = [];
      let currentDate = new Date(firstDay);
      for (let week = 1; week <= 5; week++) {
        const weekStart = new Date(currentDate);
        const weekEnd = new Date(currentDate);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        // Don't go beyond the end of the month
        if (weekEnd > lastDay) {
          weekEnd.setTime(lastDay.getTime());
        }
        
        weeks.push({
          week: week,
          start: weekStart.toISOString().split('T')[0],
          end: weekEnd.toISOString().split('T')[0]
        });
        
        currentDate.setDate(currentDate.getDate() + 7);
        if (currentDate > lastDay) break;
      }
      
      // Build country filter
      let countryFilter = '';
      const params = [];
      if (country) {
        countryFilter = 'AND sr.country = ?';
        params.push(country);
      }
      
      // Get all active sales reps with expected weekly coverage and region
      const [salesReps] = await db.query(`
        SELECT 
          sr.id,
          sr.name,
          sr.expected_weekly_coverage,
          sr.region,
          COALESCE(r.name, sr.region) as region_name
        FROM SalesRep sr
        LEFT JOIN Regions r ON sr.region = r.id OR sr.region = r.name
        WHERE sr.status = 1
        ${countryFilter}
        ORDER BY sr.name ASC
      `, params);
      
      // Get journey plans for the month with unique outlets per week
      const [journeyPlans] = await db.query(`
        SELECT 
          jp.userId,
          jp.clientId,
          DATE(jp.date) as visitDate,
          jp.status,
          jp.checkInTime
        FROM JourneyPlan jp
        INNER JOIN SalesRep sr ON jp.userId = sr.id
        WHERE DATE(jp.date) BETWEEN ? AND ?
          AND (jp.status IN (1, 2) OR jp.checkInTime IS NOT NULL)
          ${countryFilter}
      `, [startDate, endDate, ...params]);
      
      // Process data: group by sales rep and week
      const coverageData = salesReps.map(rep => {
        const repPlans = journeyPlans.filter(p => p.userId === rep.id);
        const weeklyCoverage = weeks.map(week => {
          // Get unique outlets visited in this week
          const weekVisits = repPlans.filter(p => {
            // Handle date format - could be date string or datetime
            let visitDate = p.visitDate;
            if (visitDate && visitDate.includes('T')) {
              visitDate = visitDate.split('T')[0];
            } else if (visitDate && visitDate.includes(' ')) {
              visitDate = visitDate.split(' ')[0];
            }
            return visitDate >= week.start && visitDate <= week.end;
          });
          const uniqueOutlets = new Set(weekVisits.map(v => v.clientId));
          return {
            week: week.week,
            coverage: uniqueOutlets.size
          };
        });
        
        const expected = rep.expected_weekly_coverage || null;
        const calculatePercentage = (coverage) => {
          if (expected === null || expected === 0) return null;
          return Number(((coverage / expected) * 100).toFixed(1));
        };
        
        return {
          salesRepId: rep.id,
          salesRepName: rep.name,
          region: rep.region_name || rep.region || null,
          expectedWeeklyCoverage: expected,
          week1: weeklyCoverage.find(w => w.week === 1)?.coverage || 0,
          week1Percentage: calculatePercentage(weeklyCoverage.find(w => w.week === 1)?.coverage || 0),
          week2: weeklyCoverage.find(w => w.week === 2)?.coverage || 0,
          week2Percentage: calculatePercentage(weeklyCoverage.find(w => w.week === 2)?.coverage || 0),
          week3: weeklyCoverage.find(w => w.week === 3)?.coverage || 0,
          week3Percentage: calculatePercentage(weeklyCoverage.find(w => w.week === 3)?.coverage || 0),
          week4: weeklyCoverage.find(w => w.week === 4)?.coverage || 0,
          week4Percentage: calculatePercentage(weeklyCoverage.find(w => w.week === 4)?.coverage || 0),
          week5: weeklyCoverage.find(w => w.week === 5)?.coverage || 0,
          week5Percentage: calculatePercentage(weeklyCoverage.find(w => w.week === 5)?.coverage || 0)
        };
      });
      
      res.json({ 
        success: true, 
        data: coverageData,
        month: targetMonth,
        year: targetYear,
        weeks: weeks.map(w => ({ week: w.week, start: w.start, end: w.end }))
      });
    } catch (error) {
      console.error('Get outlet coverage error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch outlet coverage', error: error.message });
    }
  }
};

module.exports = journeyPlanController; 