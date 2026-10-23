import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlansService } from './subscription-plans.service';
import {
  PublicSubscriptionPlansController,
  SubscriptionPlansController,
} from './subscription-plans.controller';
import { SubscriptionPlan, UserSubscription } from '@app/database';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionPlan, UserSubscription]),
    AuthModule,
  ],
  controllers: [PublicSubscriptionPlansController, SubscriptionPlansController],
  providers: [SubscriptionPlansService],
  exports: [SubscriptionPlansService],
})
export class SubscriptionsModule {}
