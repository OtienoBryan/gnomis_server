const db = require('./database/db');
const fs = require('fs');
const path = require('path');

async function runAddLeaderIdMigration() {
  try {
    console.log('Starting leader_id column migration for SalesRep table...');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'database', 'add_leader_id_to_salesrep.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split the SQL into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--') && !stmt.startsWith('SET'));

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim() && !statement.startsWith('PREPARE') && !statement.startsWith('EXECUTE') && !statement.startsWith('DEALLOCATE')) {
        try {
          console.log(`Executing statement ${i + 1}/${statements.length}: ${statement.substring(0, 70)}...`);
          await db.query(statement);
        } catch (err) {
          // Ignore "Duplicate column name" or "Duplicate key name" errors
          if (err.message.includes('Duplicate column name') || 
              err.message.includes('Duplicate key name') ||
              err.message.includes('already exists')) {
            console.log(`  ⚠️  Skipping (already exists): ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    }

    // Also execute the full SQL file for SET statements
    try {
      await db.query(migrationSQL);
    } catch (err) {
      if (!err.message.includes('Duplicate') && !err.message.includes('already exists')) {
        throw err;
      }
    }

    console.log('leader_id column migration completed successfully.');
    
    // Verify the column was added
    const [columns] = await db.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'SalesRep' 
      AND COLUMN_NAME = 'leader_id'
    `);
    
    if (columns.length > 0) {
      console.log('✅ leader_id column exists in SalesRep table');
      console.log('📋 Column details:');
      console.log(`  - Name: ${columns[0].COLUMN_NAME}`);
      console.log(`  - Type: ${columns[0].DATA_TYPE}`);
      console.log(`  - Nullable: ${columns[0].IS_NULLABLE}`);
      console.log(`  - Default: ${columns[0].COLUMN_DEFAULT || 'NULL'}`);
    } else {
      console.log('❌ leader_id column was not added');
    }
    
  } catch (error) {
    console.error('leader_id column migration failed:', error);
    process.exit(1);
  } finally {
    if (db.end) {
      await db.end();
    }
  }
}

runAddLeaderIdMigration();
