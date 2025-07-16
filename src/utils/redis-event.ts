import { createClient, RedisClientType } from 'redis';

let client: RedisClientType;
let subscriber: RedisClientType;

export async function createRedisClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
  }
  return client;
}

export async function createRedisSubscriber() {
  if (!subscriber) {
    subscriber = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await subscriber.connect();
  }
  return subscriber;
}

export async function connect(url?: string) {
  client = createClient({ url: url || 'redis://localhost:6379' });
  subscriber = createClient({ url: url || 'redis://localhost:6379' });

  await client.connect();
  await subscriber.connect();
}

export async function disconnect() {
  await client?.quit();
  await subscriber?.quit();
}

export async function publish(channel: string, message: string) {
  await client.publish(channel, message);
}

export async function publishEvent(channel: string, data: any) {
  const redisClient = await createRedisClient();
  await redisClient.publish(channel, JSON.stringify(data));
}

export async function subscribe(channel: string, callback: (message: string) => void) {
  await subscriber.subscribe(channel, callback);
}