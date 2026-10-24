import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('dashboard')
export class UserDashboardPageController {
  // The root dashboard endpoint continues to return authenticated JSON.
  @Get('home')
  page(@Res() response: Response): void {
    response.redirect('/dashboard');
  }
}
