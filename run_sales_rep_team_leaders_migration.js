const db = require('./database/db');
const fs = require('fs');
const path = require('path');

async function runSalesRepTeamLeadersMigration() {
  try {
    console.log('Starting sales_rep_team_leaders table migration...');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'database', 'create_sales_rep_team_leaders_table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split the SQL into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        console.log(`Executing statement ${i + 1}/${statements.length}: ${statement.substring(0, 70)}...`);
        await db.query(statement);
      }
    }

    console.log('sales_rep_team_leaders table migration completed successfully.');
    
    // Verify the table was created
    const [tables] = await db.query('SHOW TABLES LIKE "sales_rep_team_leaders"');
    if (tables.length > 0) {
      console.log('✅ sales_rep_team_leaders table exists');
      
      // Show table structure
      const [columns] = await db.query('DESCRIBE sales_rep_team_leaders');
      console.log('📋 Table structure:');
      columns.forEach(col => {
        console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Default ? `DEFAULT ${col.Default}` : ''}`);
      });
    } else {
      console.log('❌ sales_rep_team_leaders table was not created');
    }
    
  } catch (error) {
    console.error('sales_rep_team_leaders table migration failed:', error);
    process.exit(1);
  } finally {
    if (db.end) {
      await db.end();
    }
  }
}

runSalesRepTeamLeadersMigration();
