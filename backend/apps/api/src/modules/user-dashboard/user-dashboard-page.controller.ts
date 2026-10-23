import {
  Controller,
  Get,
  Header,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthCookies } from '../auth/auth.cookies';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/guards/auth.guards';
import { USER_DASHBOARD_SCRIPT } from './user-dashboard.client';
import { USER_DASHBOARD_CSS, USER_DASHBOARD_HTML } from './user-dashboard.page';

@Controller('dashboard')
export class UserDashboardPageController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  // Keep the existing GET /dashboard JSON contract separate from its page.
  @Get('home')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async page(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const user = await this.auth.currentUser(
        this.cookies.read(request, 'session'),
      );
      if (this.auth.isAdmin(user)) {
        response.redirect('/api/v1/admin');
        return;
      }
      response.type('html').send(USER_DASHBOARD_HTML);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      response.redirect('/api/v1/auth/login');
    }
  }

  @Get('client.js')
  @UseGuards(SessionGuard)
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  script(): string {
    return USER_DASHBOARD_SCRIPT;
  }

  @Get('style.css')
  @UseGuards(SessionGuard)
  @Header('Content-Type', 'text/css; charset=utf-8')
  stylesheet(): string {
    return USER_DASHBOARD_CSS;
  }
}
