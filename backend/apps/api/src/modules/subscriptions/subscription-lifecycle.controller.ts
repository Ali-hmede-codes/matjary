import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

// The owner's view of the plan lifecycle after the paid period: the grace
// countdown, the renewal request, and the shops that are currently locked.
// Everything is scoped to the signed-in account.
@Controller('subscriptions')
@UseGuards(SessionGuard)
export class SubscriptionLifecycleController {
  constructor(
    private readonly plans: SubscriptionPlansService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}

  @Get('lifecycle')
  async overview(@Req() request: AuthenticatedRequest) {
    const state = await this.plans.getSubscriptionState(request.user.id);
    return {
      state: state.state,
      planName: state.planName,
      planSlug: state.planSlug,
      expiresAt: state.expiresAt,
      daysRemaining: state.daysRemaining,
      phase: state.phase,
      graceEndsAt: state.graceEndsAt,
      renewalRequestedAt: state.renewalRequestedAt,
      // 0 means trial shops are kept forever; the locked page hides the timer.
      trialDeleteAfterHours: this.lifecycle.trialDeleteAfterHours(),
      lockedShops: await this.lifecycle.lockedShops(request.user.id),
    };
  }

  // Records intent only. The administrator still confirms the payment and
  // extends or assigns the plan, which is what reopens the shops.
  @Post('renewal-request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  requestRenewal(@Req() request: AuthenticatedRequest) {
    return this.plans.requestRenewal(request.user.id);
  }
}
