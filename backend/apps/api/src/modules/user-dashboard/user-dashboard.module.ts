import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDashboardService } from './user-dashboard.service';
import { UserDashboardController } from './user-dashboard.controller';
import { UserDashboardPageController } from './user-dashboard-page.controller';
import {
  User,
  Store,
  Showcase,
  Product,
  MediaAsset,
  PostEngagement,
  UserSubscription,
  SubscriptionPlan,
} from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Store,
      Showcase,
      Product,
      MediaAsset,
      PostEngagement,
      UserSubscription,
      SubscriptionPlan,
    ]),
    AuthModule,
    SubscriptionsModule,
  ],
  controllers: [UserDashboardController, UserDashboardPageController],
  providers: [UserDashboardService],
  exports: [UserDashboardService],
})
export class UserDashboardModule {}
