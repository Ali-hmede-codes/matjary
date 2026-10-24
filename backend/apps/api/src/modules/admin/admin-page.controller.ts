import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('admin')
export class AdminPageController {
  @Get()
  page(@Res() response: Response): void {
    response.redirect('/admin');
  }
}
