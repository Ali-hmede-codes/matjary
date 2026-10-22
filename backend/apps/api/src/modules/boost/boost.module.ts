import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BoostCoin,
  BoostTransaction,
  BoostCampaign,
  BoostCampaignPerformance,
  BoostSetting,
} from '@app/database';
import { BoostService } from './boost.service';
import { BoostController } from './boost.controller';
import { ConfigurationModule } from '@app/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BoostCoin,
      BoostTransaction,
      BoostCampaign,
      BoostCampaignPerformance,
      BoostSetting,
    ]),
    ConfigurationModule,
  ],
  controllers: [BoostController],
  providers: [BoostService],
  exports: [BoostService],
})
export class BoostModule {}
