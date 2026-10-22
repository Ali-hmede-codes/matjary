import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 3000),
    });
    this.client.on('error', () =>
      this.logger.warn('Redis connection unavailable'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithTtl(key: string, value: string, seconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', seconds);
  }

  async remove(key: string): Promise<void> {
    await this.client.del(key);
  }

  async consume(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  async incrementWithTtl(key: string, seconds: number): Promise<number> {
    // Atomic increment and expiry prevent immortal keys after a process crash.
    return Number(
      await this.client.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
        1,
        key,
        seconds,
      ),
    );
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return Number(await this.client.hset(key, field, value));
  }

  async sadd(key: string, member: string): Promise<number> {
    return Number(await this.client.sadd(key, member));
  }

  async smembers(key: string): Promise<string[]> {
    return (await this.client.smembers(key)) as string[];
  }

  async srem(key: string, member: string): Promise<number> {
    return Number(await this.client.srem(key, member));
  }

  async hdel(key: string, field: string): Promise<number> {
    return Number(await this.client.hdel(key, field));
  }

  async hexists(key: string, field: string): Promise<boolean> {
    return (await this.client.hexists(key, field)) === 1;
  }

  async hlen(key: string): Promise<number> {
    return Number(await this.client.hlen(key));
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  /**
   * SET key value NX EX seconds. Returns true only when the key was set.
   * Used for distributed leader locks so only one API node schedules flushes.
   */
  async setIfNotExistsWithTtl(
    key: string,
    value: string,
    seconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', seconds, 'NX');
    return result === 'OK';
  }

  /**
   * Redis SCAN over keys matching a pattern. Used to flush buffered engagement
   * counters back to MySQL. `count` is a hint, not a hard limit.
   */
  async scan(
    cursor: number,
    match: string,
    count = 100,
  ): Promise<[number, string[]]> {
    const [next, keys] = await this.client.scan(
      cursor,
      'MATCH',
      match,
      'COUNT',
      count,
    );
    return [Number(next), keys as string[]];
  }

  async evaluate(script: string, keys: string[], arguments_: string[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...arguments_);
  }

  async ping(): Promise<void> {
    if ((await this.client.ping()) !== 'PONG') {
      throw new Error('Redis ping failed');
    }
  }
}
