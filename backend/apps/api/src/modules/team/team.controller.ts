import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/guards/auth.guards';
import { InviteTeamMemberDto } from './dto/team.dto';
import { TeamService } from './team.service';

@Controller()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('stores/:storeSlug/team')
  @UseGuards(SessionGuard)
  list(
    @Param('storeSlug') storeSlug: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.team.list(storeSlug, request.user.id);
  }

  // One address in, one clear answer: access granted or invitation created.
  @Post('stores/:storeSlug/team')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  invite(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: InviteTeamMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.team.invite(storeSlug, dto.email, request.user);
  }

  @Delete('stores/:storeSlug/team/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async removeMember(
    @Param('storeSlug') storeSlug: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.team.removeMember(storeSlug, memberId, request.user.id);
  }

  @Delete('stores/:storeSlug/team/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async cancelInvitation(
    @Param('storeSlug') storeSlug: string,
    @Param('invitationId', new ParseUUIDPipe({ version: '4' }))
    invitationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.team.cancelInvitation(storeSlug, invitationId, request.user.id);
  }

  // Invitations waiting for the signed-in Gmail account.
  @Get('team/invitations')
  @UseGuards(SessionGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.team.mine(request.user);
  }

  @Post('team/invitations/:invitationId/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  accept(
    @Param('invitationId', new ParseUUIDPipe({ version: '4' }))
    invitationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.team.accept(invitationId, request.user);
  }

  @Post('team/invitations/:invitationId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async decline(
    @Param('invitationId', new ParseUUIDPipe({ version: '4' }))
    invitationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.team.decline(invitationId, request.user);
  }

  // A member may leave a shop without waiting for the owner.
  @Delete('team/memberships/:storeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async leave(
    @Param('storeId', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.team.leave(storeId, request.user.id);
  }
}
