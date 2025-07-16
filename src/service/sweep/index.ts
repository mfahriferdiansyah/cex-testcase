import { sweepController } from './controller';
import { createRedisClient, createRedisSubscriber } from '../../utils/redis-event';
import { db } from '../../database/config';

const port = process.env.PORT || 3002;

export async function startSweepService() {
  console.log(`Starting Sweep Service on port ${port}...`);
  
  try {
    const redisClient = await createRedisClient();
    const subscriber = await createRedisSubscriber();
    
    const handleMessage = async (message: string, channel: string) => {
      console.log(`[Sweep Service] Received event: ${channel} - ${message}`);
      
      try {
        const data = JSON.parse(message);
        
        switch (channel) {
          case 'hot_wallet:insufficient':
            await sweepController.handleHotWalletInsufficient(data);
            break;
          case 'warm_wallet:sweepable':
            await sweepController.handleWarmWalletSweepable(data);
            break;
          case 'warm_wallet:insufficient':
            await sweepController.handleWarmWalletInsufficient(data);
            break;
          case 'deposit_wallet:sweepable':
            await sweepController.handleDepositWalletSweepable(data);
            break;
          case 'deposit_wallet:insufficient':
            await sweepController.handleDepositWalletInsufficient(data);
            break;
          default:
            console.log(`[Sweep Service] Unknown event: ${channel}`);
        }
      } catch (error) {
        console.error(`[Sweep Service] Error processing event: ${error}`);
      }
    };

    await subscriber.subscribe('hot_wallet:insufficient', handleMessage);
    await subscriber.subscribe('warm_wallet:sweepable', handleMessage);
    await subscriber.subscribe('warm_wallet:insufficient', handleMessage);
    await subscriber.subscribe('deposit_wallet:sweepable', handleMessage);
    await subscriber.subscribe('deposit_wallet:insufficient', handleMessage);
    
    // Start proactive USDC monitoring
    await sweepController.startUSDCMonitoring();
    
    process.on('SIGTERM', async () => {
      console.log('[Sweep Service] Shutting down...');
      await sweepController.stopUSDCMonitoring();
      await subscriber.quit();
      await redisClient.quit();
      process.exit(0);
    });
    
    console.log(`[Sweep Service] Running on port ${port}`);
    console.log(`[Sweep Service] Listening for Redis events...`);
    
  } catch (error) {
    console.error(`[Sweep Service] Failed to start:`, error);
    process.exit(1);
  }
}

if (require.main === module) {
  startSweepService();
}