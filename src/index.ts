import dotenv from 'dotenv';
dotenv.config();

import { startGasService } from './service/gas/index';
import { startSweepService } from './service/sweep/index';
import { startWithdrawalService } from './service/withdrawal/index';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  let service: string | null = null;
  let runAll = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service' && args[i + 1]) {
      service = args[i + 1];
      i++; // Skip the next argument
    } else if (args[i] === '--all') {
      runAll = true;
    }
  }
  
  try {
    if (runAll) {
      console.log('Starting all services...');
      await Promise.all([
        startGasService(),
        startSweepService(),
        startWithdrawalService()
      ]);
    } else if (service) {
      console.log(`Starting ${service} service...`);
      
      switch (service) {
        case 'gas':
          await startGasService();
          break;
        case 'sweep':
          await startSweepService();
          break;
        case 'withdrawal':
          await startWithdrawalService();
          break;
        default:
          console.error(`Unknown service: ${service}`);
          console.log('Available services: gas, sweep, withdrawal');
          process.exit(1);
      }
    } else {
      console.log('CEX Wallet Manager');
      console.log('');
      console.log('Usage:');
      console.log('  npm start -- --service <service_name>  Run specific service');
      console.log('  npm start -- --all                    Run all services');
      console.log('');
      console.log('Available services: gas, sweep, withdrawal');
      console.log('');
      console.log('Examples:');
      console.log('  npm start -- --service gas');
      console.log('  npm start -- --service sweep');
      console.log('  npm start -- --service withdrawal');
      console.log('  npm start -- --all');
    }
  } catch (error) {
    console.error('Failed to start service(s):', error);
    process.exit(1);
  }
}

main();