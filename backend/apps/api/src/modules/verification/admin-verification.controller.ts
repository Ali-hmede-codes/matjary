import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AdminActor } from '@app/database';
import {
  AdminGuard,
  MutationGuard,
  SessionGuard,
} from '../auth/guards/auth.guards';
import { Actor } from '../admin/admin-context.interceptor';
import { VerificationService } from './verification.service';
import {
  AdminVerificationListDto,
  AdminVerificationStoresDto,
  VerificationReasonDto,
} from './dto/verification.dto';

// The administrator's verification queue: review pending applications, approve
// a month, reject with a reason, and extend verified shops with one button.
@Controller('admin/verification')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('requests')
  requests(
    @Query() query: AdminVerificationListDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminListRequests(actor, query);
  }

  @Get('stores')
  stores(
    @Query() query: AdminVerificationStoresDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminListStores(actor, query);
  }

  @Post('requests/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminApprove(actor, id, dto.reason);
  }

  @Post('requests/:id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminReject(actor, id, dto.reason);
  }

  @Post('stores/:id/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminExtend(actor, id, dto.reason);
  }

  // Special shops (partners, long-standing businesses) can be verified with no
  // end date; only a revoke removes that badge.
  @Post('stores/:id/unlimited')
  unlimited(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminGrantUnlimited(actor, id, dto.reason);
  }

  @Post('stores/:id/revoke')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.verification.adminRevoke(actor, id, dto.reason);
  }
}
