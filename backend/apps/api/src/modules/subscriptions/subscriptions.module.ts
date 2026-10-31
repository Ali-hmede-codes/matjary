import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlansService } from './subscription-plans.service';
import {
  PublicSubscriptionPlansController,
  SubscriptionPlansController,
} from './subscription-plans.controller';
import { SubscriptionLifecycleController } from './subscription-lifecycle.controller';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionLifecycleScheduler } from './subscription-lifecycle.scheduler';
import { SubscriptionPlan, UserSubscription } from '@app/database';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionPlan, UserSubscription]),
    AuthModule,
  ],
  controllers: [
    PublicSubscriptionPlansController,
    SubscriptionPlansController,
    SubscriptionLifecycleController,
  ],
  providers: [
    SubscriptionPlansService,
    SubscriptionLifecycleService,
    SubscriptionLifecycleScheduler,
  ],
  exports: [SubscriptionPlansService, SubscriptionLifecycleService],
})
export class SubscriptionsModule {}
