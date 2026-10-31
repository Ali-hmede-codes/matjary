import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AdminActor } from '@app/database';
import {
  AdminGuard,
  MutationGuard,
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { Actor } from '../admin/admin-context.interceptor';
import { SubscriptionPlansService } from '../subscriptions/subscription-plans.service';
import { RenewalNoticesService } from './renewal-notices.service';
import { AdminRenewalQueryDto, RenewalReasonDto } from './dto/renewal.dto';

// Platform-wide renewal work queue. The reason is carried into the audit
// context by AdminContextInterceptor, exactly like every other admin write.
@Controller('admin/renewals')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class AdminRenewalsController {
  constructor(
    private readonly notifications: RenewalNoticesService,
    private readonly plans: SubscriptionPlansService,
  ) {}

  @Get()
  queue(@Query() query: AdminRenewalQueryDto, @Actor() actor: AdminActor) {
    return this.notifications.adminQueue(actor, query.kind);
  }

  @Get('summary')
  summary(@Actor() actor: AdminActor) {
    return this.notifications.adminSummary(actor);
  }

  // One-click "+1 month" for the plan. The badge extension keeps its existing
  // route in the verification controller so both sections share the same rules.
  @Post('subscriptions/:id/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: RenewalReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.extendSubscription(id, request.user.id);
  }
}
