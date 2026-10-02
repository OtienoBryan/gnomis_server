const db = require('../database/db');

const userLocationController = {
  // GET /api/user-locations/staff - last known position of each staff member (SalesRep table)
  getStaffLocations: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT
          sr.id, sr.name, sr.email, sr.phoneNumber, sr.role, sr.status,
          sr.region, sr.route_name_update AS route_name,
          sr.latitude, sr.longitude, sr.last_updated AS last_update
        FROM SalesRep sr
        WHERE sr.latitude IS NOT NULL
          AND sr.longitude IS NOT NULL
          AND NOT (sr.latitude = 0 AND sr.longitude = 0)
        ORDER BY sr.last_updated DESC
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching staff locations:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch staff locations' });
    }
  },

  // GET /api/user-locations/users - one row per user with their latest recorded point
  getUsersWithLocation: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT
          latest.user_id,
          latest.role,
          latest.latitude,
          latest.longitude,
          latest.recorded_at,
          COALESCE(sr.name, st.name, CONCAT('User ', latest.user_id)) as user_name,
          cnt.point_count
        FROM user_locations latest
        INNER JOIN (
          SELECT user_id, MAX(recorded_at) as max_recorded_at
          FROM user_locations
          GROUP BY user_id
        ) mx ON mx.user_id = latest.user_id AND mx.max_recorded_at = latest.recorded_at
        LEFT JOIN SalesRep sr ON sr.id = latest.user_id
        LEFT JOIN staff st ON st.id = latest.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as point_count
          FROM user_locations
          GROUP BY user_id
        ) cnt ON cnt.user_id = latest.user_id
        ORDER BY latest.recorded_at DESC
      `);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error fetching users with location:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user locations' });
    }
  },

  // GET /api/user-locations/journey/:userId?date=YYYY-MM-DD - ordered points for one user's journey
  getUserJourney: async (req, res) => {
    try {
      const { userId } = req.params;
      let { date } = req.query;

      if (!date) {
        const [latestDateRows] = await db.query(
          'SELECT DATE(MAX(recorded_at)) as latest_date FROM user_locations WHERE user_id = ?',
          [userId]
        );
        date = latestDateRows[0]?.latest_date
          ? new Date(latestDateRows[0].latest_date).toISOString().slice(0, 10)
          : null;
      }

      const [nameRows] = await db.query(
        `SELECT COALESCE(sr.name, st.name, CONCAT('User ', ?)) as user_name
         FROM (SELECT 1) dummy
         LEFT JOIN SalesRep sr ON sr.id = ?
         LEFT JOIN staff st ON st.id = ?`,
        [userId, userId, userId]
      );
      const userName = nameRows[0]?.user_name || `User ${userId}`;

      let points = [];
      if (date) {
        const [rows] = await db.query(
          `SELECT id, user_id, role, latitude, longitude, recorded_at
           FROM user_locations
           WHERE user_id = ? AND DATE(recorded_at) = ?
           ORDER BY recorded_at ASC`,
          [userId, date]
        );
        points = rows;
      }

      const current = points.length > 0 ? points[points.length - 1] : null;

      res.json({
        success: true,
        data: {
          user_id: parseInt(userId),
          user_name: userName,
          date,
          points,
          current
        }
      });
    } catch (error) {
      console.error('Error fetching user journey:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user journey' });
    }
  }
};

module.exports = userLocationController;
