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
import { AuthService } from '../auth/auth.service';
import { AuthCookies } from '../auth/auth.cookies';
import { SessionGuard, AdminGuard } from '../auth/guards/auth.guards';
import { ADMIN_HTML, ADMIN_CSS } from './ui/admin.page';
import { ADMIN_SCRIPT } from './ui/admin.client';
import { ADMIN_SCHEMA_SCRIPT } from './ui/admin.schema';

@Controller('admin')
export class AdminPageController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get()
  async page(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const user = await this.auth.currentUser(
        this.cookies.read(request, 'session'),
      );
      if (!this.auth.isAdmin(user)) {
        response
          .status(403)
          .type('html')
          .send(
            '<!doctype html><html lang="en"><meta charset="utf-8"><title>Admin access required</title><h1>Admin access required</h1><p>This Google account is not an administrator.</p><a href="/api/v1/dashboard/home">Go to your personal dashboard</a></html>',
          );
        return;
      }
      response.type('html').send(ADMIN_HTML);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      response.redirect('/api/v1/auth/login');
    }
  }

  @Get('client.js')
  @UseGuards(SessionGuard, AdminGuard)
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  script(): string {
    return ADMIN_SCRIPT;
  }

  @Get('schema.js')
  @UseGuards(SessionGuard, AdminGuard)
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  schema(): string {
    return ADMIN_SCHEMA_SCRIPT;
  }

  @Get('style.css')
  @UseGuards(SessionGuard, AdminGuard)
  @Header('Content-Type', 'text/css; charset=utf-8')
  stylesheet(): string {
    return ADMIN_CSS;
  }
}
