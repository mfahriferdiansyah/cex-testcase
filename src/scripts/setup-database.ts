import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function setupDatabase() {
  // Parse the DATABASE_URL to extract components
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found in environment variables');
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  const dbName = url.pathname.substring(1); // Remove leading slash
  
  // Create connection to PostgreSQL server (without specific database)
  const serverClient = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: 'postgres' // Connect to default postgres database
  });

  try {
    console.log('🔄 Connecting to PostgreSQL server...');
    await serverClient.connect();
    
    // Check if database exists
    const result = await serverClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    
    if (result.rows.length === 0) {
      console.log(`🔄 Database '${dbName}' does not exist. Creating...`);
      await serverClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database '${dbName}' created successfully!`);
    } else {
      console.log(`✅ Database '${dbName}' already exists.`);
    }
    
    await serverClient.end();
    
    // Now test connection to the specific database
    console.log('🔄 Testing connection to application database...');
    const appClient = new Client({
      connectionString: databaseUrl
    });
    
    await appClient.connect();
    await appClient.query('SELECT 1');
    await appClient.end();
    
    console.log('✅ Database connection test successful!');
    console.log('');
    console.log('🎯 Next steps:');
    console.log('   1. Run database migrations: npm run db:push');
    console.log('   2. Start the services: npm run start:gas, npm run start:sweep, npm run start:withdrawal');
    console.log('');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

// Run the setup
setupDatabase().catch(console.error);