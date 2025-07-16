import { gasController } from './controller';
import { createRedisClient, createRedisSubscriber } from '../../utils/redis-event';
import { db } from '../../database/config';

const port = process.env.PORT || 3001;

export async function startGasService() {
  console.log(`Starting Gas Service on port ${port}...`);
  
  try {
    const redisClient = await createRedisClient();
    const subscriber = await createRedisSubscriber();
    
    await subscriber.subscribe('gas:low', async (message: string, channel: string) => {
      console.log(`[Gas Service] Received event: ${channel} - ${message}`);
      
      try {
        const data = JSON.parse(message);
        await gasController.handleGasLow(data);
      } catch (error) {
        console.error(`[Gas Service] Error processing event: ${error}`);
      }
    });
    
    // Start proactive gas monitoring
    await gasController.startGasMonitoring();
    
    process.on('SIGTERM', async () => {
      console.log('[Gas Service] Shutting down...');
      await gasController.stopGasMonitoring();
      await subscriber.quit();
      await redisClient.quit();
      process.exit(0);
    });
    
    console.log(`[Gas Service] Running on port ${port}`);
    console.log(`[Gas Service] Listening for Redis events...`);
    
  } catch (error) {
    console.error(`[Gas Service] Failed to start:`, error);
    process.exit(1);
  }
}

if (require.main === module) {
  startGasService();
}