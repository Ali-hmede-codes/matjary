import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { RenewalNoticesService } from './renewal-notices.service';
import { OwnerNotificationListDto } from './dto/renewal.dto';

// The owner's renewal reminders. Every read and write is scoped to the signed-in
// account; a badge reminder is addressed to the shop owner, never a team member.
@Controller('notifications')
@UseGuards(SessionGuard)
export class RenewalNoticesController {
  constructor(private readonly notifications: RenewalNoticesService) {}

  @Get()
  list(
    @Query() query: OwnerNotificationListDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.ownerList(
      request.user.id,
      query.limit,
      query.offset,
    );
  }

  @Get('summary')
  summary(@Req() request: AuthenticatedRequest) {
    return this.notifications.ownerSummary(request.user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  readAll(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllSeen(request.user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.markSeen(request.user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.decline(request.user.id, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.resume(request.user.id, id);
  }
}
