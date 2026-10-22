import { Module } from '@nestjs/common';
import { ConfigurationModule } from '@app/config';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigurationModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
