import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthCookies } from './auth.cookies';
import { GoogleLoginDto } from './dto/google-login.dto';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  type AuthenticatedRequest,
} from './guards/auth.guards';
import { AUTH_HTML, AUTH_SCRIPT } from './auth.page';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  loginPage(): string {
    return AUTH_HTML;
  }

  @Get('client.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  clientScript(): string {
    return AUTH_SCRIPT;
  }

  @Post('bootstrap')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  async bootstrap(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challenge = await this.auth.begin(
      this.cookies.read(request, 'nonce'),
    );
    this.cookies.set(response, 'nonce', challenge.token);
    return { clientId: challenge.clientId, nonce: challenge.nonce };
  }

  @Post('google')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  async google(
    @Body() body: GoogleLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.signIn(
      body.credential,
      this.cookies.read(request, 'nonce'),
      this.cookies.read(request, 'session'),
    );
    this.cookies.clear(response, 'nonce');
    this.cookies.set(response, 'session', result.token);
    return { user: result.user, isAdmin: this.auth.isAdmin(result.user) };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.user, isAdmin: this.auth.isAdmin(request.user) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.cookies.read(request, 'session'));
    this.cookies.clear(response, 'session');
    this.cookies.clear(response, 'nonce');
  }
}
