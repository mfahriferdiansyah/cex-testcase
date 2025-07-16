import { withdrawalController } from './controller';
import { createRedisClient, createRedisSubscriber } from '../../utils/redis-event';
import { db } from '../../database/config';

const port = process.env.PORT || 3003;

export async function startWithdrawalService() {
  console.log(`Starting Withdrawal Service on port ${port}...`);
  
  try {
    const redisClient = await createRedisClient();
    const subscriber = await createRedisSubscriber();
    
    await subscriber.subscribe('replinish:hot_wallet', async (message: string, channel: string) => {
      console.log(`[Withdrawal Service] Received event: ${channel} - ${message}`);
      
      try {
        const data = JSON.parse(message);
        await withdrawalController.handleHotWalletReplenished(data);
      } catch (error) {
        console.error(`[Withdrawal Service] Error processing event: ${error}`);
      }
    });
    
    withdrawalController.startQueueProcessor();
    
    await withdrawalController.startDepositMonitoring();
    
    process.on('SIGTERM', async () => {
      console.log('[Withdrawal Service] Shutting down...');
      withdrawalController.stopQueueProcessor();
      withdrawalController.stopDepositMonitoring();
      await subscriber.quit();
      await redisClient.quit();
      process.exit(0);
    });
    
    console.log(`[Withdrawal Service] Running on port ${port}`);
    console.log(`[Withdrawal Service] Listening for Redis events...`);
    console.log(`[Withdrawal Service] Queue processor started...`);
    console.log(`[Withdrawal Service] Deposit monitoring started...`);
    console.log(`[Withdrawal Service] Using RPC: ${process.env.ARBITRUM_SEPOLIA_RPC}`);
    
  } catch (error) {
    console.error(`[Withdrawal Service] Failed to start:`, error);
    process.exit(1);
  }
}

if (require.main === module) {
  startWithdrawalService();
}