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
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto } from './dto/verification.dto';

// Owner-facing routes for one shop. A team member can help with content but
// only the shop owner may apply for or withdraw a verification badge.
@Controller('stores/:storeId/verification')
@UseGuards(SessionGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  status(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.verification.status(storeId, request.user.id);
  }

  @Post('request')
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  submit(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: SubmitVerificationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.verification.submit(storeId, request.user.id, dto);
  }

  @Delete('request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  async withdraw(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.verification.withdraw(storeId, request.user.id);
  }
}
