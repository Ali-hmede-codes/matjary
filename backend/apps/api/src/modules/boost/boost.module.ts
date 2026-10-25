import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BoostCoin,
  BoostTransaction,
  BoostCampaign,
  BoostCampaignPerformance,
  BoostSetting,
  User,
  Store,
  Showcase,
} from '@app/database';
import { BoostService } from './boost.service';
import { BoostController } from './boost.controller';
import { ConfigurationModule } from '@app/config';
import { RedisModule } from '@app/queue';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BoostCoin,
      BoostTransaction,
      BoostCampaign,
      BoostCampaignPerformance,
      BoostSetting,
      User,
      Store,
      Showcase,
    ]),
    ConfigurationModule,
    AuthModule,
    RedisModule,
  ],
  controllers: [BoostController],
  providers: [BoostService],
  exports: [BoostService],
})
export class BoostModule {}
