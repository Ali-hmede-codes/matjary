import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan, User, UserSubscription } from '@app/database';

import { FreeTrialService } from './free-trial.service';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SubscriptionPlan, UserSubscription]),
  ],
  providers: [UsersService, FreeTrialService],
  exports: [UsersService, FreeTrialService],
})
export class UsersModule {}
