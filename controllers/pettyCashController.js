const db = require('../database/db');

const METHODS = ['cash', 'bank_transfer', 'mpesa', 'cheque', 'other'];

// Idempotent schema setup: SalesRep.balance, petty_cash_allocations and sales_rep_ledger.
// (Same SQL is in database/create_petty_cash_tables.sql for manual runs.)
let schemaReady = false;
const ensureSchema = async (conn) => {
  if (schemaReady) return;
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SalesRep' AND COLUMN_NAME = 'balance'`
  );
  if (cols.length === 0) {
    await conn.query(`ALTER TABLE SalesRep ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0`);
  }
  await conn.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_allocations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sales_rep_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      allocation_date DATE NOT NULL,
      payment_method VARCHAR(30) NOT NULL,
      reference VARCHAR(100) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pca_rep (sales_rep_id)
    )
  `);
  // credit = cash given to the rep (increases balance), debit = cash spent/returned (decreases it)
  await conn.query(`
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_srl_rep (sales_rep_id, date)
    )
  `);
  // created_by_name: the poster's name from their login token, so it never depends on which user table the id came from
  for (const table of ['petty_cash_allocations', 'sales_rep_ledger']) {
    const [nameCol] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'created_by_name'`,
      [table]
    );
    if (nameCol.length === 0) {
      await conn.query(`ALTER TABLE ${table} ADD COLUMN created_by_name VARCHAR(255) NULL`);
    }
  }
  schemaReady = true;
};

const pettyCashController = {
  // Sales reps with their current petty cash balance, for the allocation form
  listSalesReps: async (req, res) => {
    try {
      await ensureSchema(db);
      const [rows] = await db.query(
        `SELECT sr.id, sr.name, sr.status, sr.balance,
                (SELECT MAX(a.allocation_date) FROM petty_cash_allocations a WHERE a.sales_rep_id = sr.id) AS last_allocation_date,
                (SELECT COALESCE(SUM(a.amount), 0) FROM petty_cash_allocations a WHERE a.sales_rep_id = sr.id) AS total_allocated
         FROM SalesRep sr
         ORDER BY sr.name ASC`
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error listing sales reps for petty cash:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch sales reps' });
    }
  },

  // One sales rep with their petty cash totals and full ledger
  getStaffDetails: async (req, res) => {
    try {
      await ensureSchema(db);
      const { id } = req.params;
      const [reps] = await db.query('SELECT * FROM SalesRep WHERE id = ?', [id]);
      if (reps.length === 0) {
        return res.status(404).json({ success: false, error: 'Sales rep not found' });
      }
      // Only expose profile fields, never credentials
      const r = reps[0];
      const rep = {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone || r.phoneNumber || r.contact,
        country: r.country,
        region: r.region,
        route_name_update: r.route_name_update,
        status: r.status,
        balance: r.balance,
      };
      const [ledger] = await db.query(
        `SELECT l.*, COALESCE(st.name, l.created_by_name) AS created_by_name
         FROM sales_rep_ledger l
         LEFT JOIN staff st ON l.created_by = st.id
         WHERE l.sales_rep_id = ?
         ORDER BY l.date DESC, l.id DESC`,
        [id]
      );
      const total_allocated = ledger.reduce((s, r) => s + Number(r.credit || 0), 0);
      const total_spent = ledger.reduce((s, r) => s + Number(r.debit || 0), 0);
      res.json({ success: true, data: { rep, total_allocated, total_spent, ledger } });
    } catch (error) {
      console.error('Error fetching petty cash staff details:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch staff petty cash details' });
    }
  },

  listAllocations: async (req, res) => {
    try {
      await ensureSchema(db);
      const { sales_rep_id } = req.query;
      const params = [];
      let where = '';
      if (sales_rep_id) {
        where = 'WHERE a.sales_rep_id = ?';
        params.push(sales_rep_id);
      }
      const [rows] = await db.query(
        `SELECT a.*, sr.name AS sales_rep_name, l.running_balance,
                COALESCE(st.name, a.created_by_name) AS created_by_name
         FROM petty_cash_allocations a
         LEFT JOIN SalesRep sr ON a.sales_rep_id = sr.id
         LEFT JOIN staff st ON a.created_by = st.id
         LEFT JOIN sales_rep_ledger l ON l.reference_type = 'petty_cash' AND l.reference_id = a.id
         ${where}
         ORDER BY a.allocation_date DESC, a.id DESC
         LIMIT 200`,
        params
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Error listing petty cash allocations:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch allocations' });
    }
  },

  // Allocate petty cash: add to the rep's balance and write a sales_rep_ledger entry
  allocate: async (req, res) => {
    const { sales_rep_id, amount, allocation_date, payment_method, reference, notes } = req.body || {};
    const value = Number(amount);

    if (!sales_rep_id) return res.status(400).json({ success: false, error: 'Sales rep is required' });
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be greater than zero' });
    }
    if (!allocation_date || Number.isNaN(Date.parse(allocation_date))) {
      return res.status(400).json({ success: false, error: 'A valid date is required' });
    }
    if (!METHODS.includes(payment_method)) {
      return res.status(400).json({ success: false, error: 'Invalid payment method' });
    }

    const conn = await db.getConnection();
    try {
      await ensureSchema(conn);
      await conn.beginTransaction();

      // Lock the rep row so concurrent allocations can't corrupt the running balance
      const [reps] = await conn.query(
        'SELECT id, name, balance FROM SalesRep WHERE id = ? FOR UPDATE',
        [sales_rep_id]
      );
      if (reps.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Sales rep not found' });
      }
      const rep = reps[0];
      const newBalance = Math.round((Number(rep.balance || 0) + value) * 100) / 100;
      // The posting user comes from the verified JWT, never from the request body
      const userId = req.user?.id || null;
      const userName = req.user?.name || null;

      const [alloc] = await conn.query(
        `INSERT INTO petty_cash_allocations (sales_rep_id, amount, allocation_date, payment_method, reference, notes, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sales_rep_id, value, allocation_date, payment_method, reference || null, notes || null, userId, userName]
      );

      await conn.query(
        `INSERT INTO sales_rep_ledger
           (sales_rep_id, date, description, reference_type, reference_id, payment_method, reference, debit, credit, running_balance, created_by, created_by_name)
         VALUES (?, ?, ?, 'petty_cash', ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          sales_rep_id,
          allocation_date,
          `Petty cash allocation${reference ? ` (${reference})` : ''}`,
          alloc.insertId,
          payment_method,
          reference || null,
          value,
          newBalance,
          userId,
          userName,
        ]
      );

      await conn.query('UPDATE SalesRep SET balance = ? WHERE id = ?', [newBalance, sales_rep_id]);

      await conn.commit();
      res.status(201).json({
        success: true,
        message: 'Petty cash allocated successfully',
        data: { id: alloc.insertId, sales_rep_id: Number(sales_rep_id), amount: value, balance: newBalance },
      });
    } catch (error) {
      await conn.rollback();
      console.error('Error allocating petty cash:', error);
      res.status(500).json({ success: false, error: 'Failed to allocate petty cash' });
    } finally {
      conn.release();
    }
  },
};

module.exports = pettyCashController;
