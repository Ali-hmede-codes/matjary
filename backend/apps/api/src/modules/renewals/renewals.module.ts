import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RenewalNoticesController } from './renewal-notices.controller';
import { AdminRenewalsController } from './admin-renewals.controller';
import { RenewalNoticesService } from './renewal-notices.service';
import { RenewalScheduler } from './renewal-scheduler.service';

// Renewal reminders are read by owners and worked by global administrators.
// The module owns the stored notices, the live admin queue, and the midnight
// timer; subscription extension stays in SubscriptionsModule where the plan
// write rules already live.
@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [RenewalNoticesController, AdminRenewalsController],
  providers: [RenewalNoticesService, RenewalScheduler],
  exports: [RenewalNoticesService],
})
export class RenewalsModule {}
