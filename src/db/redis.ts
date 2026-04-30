import Redis from 'ioredis';
import { config } from '../config/env.js';
import { logError } from '../lib/logger.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  logError('Redis connection error', err);
});

redis.on('connect', () => {
  console.log('✓ Redis connected');
});
