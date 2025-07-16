import { Client } from 'pg';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(spawn);

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function setupDatabase() {
  console.log('🚀 CEX Wallet Manager - Complete Database Setup');
  console.log('================================================\n');
  
  // Parse the DATABASE_URL to extract components
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found in environment variables');
    console.error('Please set DATABASE_URL in your .env file');
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  const dbName = url.pathname.substring(1); // Remove leading slash
  
  // Step 1: Create database if it doesn't exist
  console.log('📋 Step 1: Creating database if needed...');
  const serverClient = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: 'postgres' // Connect to default postgres database
  });

  try {
    await serverClient.connect();
    
    // Check if database exists
    const result = await serverClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    
    if (result.rows.length === 0) {
      console.log(`   Creating database '${dbName}'...`);
      await serverClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`   ✅ Database '${dbName}' created successfully!`);
    } else {
      console.log(`   ✅ Database '${dbName}' already exists.`);
    }
    
    await serverClient.end();
    
    // Step 2: Test connection to the application database
    console.log('\n📋 Step 2: Testing database connection...');
    const appClient = new Client({
      connectionString: databaseUrl
    });
    
    await appClient.connect();
    await appClient.query('SELECT 1');
    await appClient.end();
    console.log('   ✅ Database connection test successful!');
    
    // Step 3: Run database migrations
    console.log('\n📋 Step 3: Running database migrations...');
    await runCommand('npm', ['run', 'db:push']);
    console.log('   ✅ Database migrations completed!');
    
    // Step 4: Success message
    console.log('\n🎉 Database setup completed successfully!');
    console.log('');
    console.log('🎯 Next steps:');
    console.log('   1. Create test wallets: npm run create-wallets');
    console.log('   2. Start services in separate terminals:');
    console.log('      - npm run start:gas');
    console.log('      - npm run start:sweep');
    console.log('      - npm run start:withdrawal');
    console.log('   3. Open test menu: npm test');
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Database setup failed:', error);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   - Make sure PostgreSQL is running');
    console.error('   - Check your DATABASE_URL in .env file');
    console.error('   - Verify PostgreSQL credentials');
    console.error('');
    process.exit(1);
  }
}

// Run the setup
setupDatabase().catch(console.error);