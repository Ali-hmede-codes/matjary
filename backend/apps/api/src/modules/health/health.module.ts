import { Module } from '@nestjs/common';
import { RedisModule } from '@app/queue';
import { HealthController } from './health.controller';

@Module({
  imports: [RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
