import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '@app/queue/redis.service';

export async function checkDependency(
  check: () => Promise<unknown>,
  timeoutMs = 2000,
): Promise<'up' | 'down'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Health check timeout')),
          timeoutMs,
        );
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Controller('health')
export class HealthController {
  // Share in-flight checks so timed-out database calls cannot fill the pool.
  private databaseProbe?: Promise<unknown>;

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<{
    status: 'ok';
    checks: { mysql: 'up' | 'down'; redis: 'up' | 'down' };
  }> {
    const [mysql, redis] = await Promise.all([
      checkDependency(() => this.checkDatabase()),
      checkDependency(() => this.redis.ping()),
    ]);
    const checks = { mysql, redis };
    if (mysql === 'down' || redis === 'down') {
      // Never return raw driver errors, addresses, or credentials publicly.
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }

  private checkDatabase(): Promise<unknown> {
    if (!this.databaseProbe) {
      this.databaseProbe = this.database.query('SELECT 1').finally(() => {
        this.databaseProbe = undefined;
      });
    }
    return this.databaseProbe;
  }
}
