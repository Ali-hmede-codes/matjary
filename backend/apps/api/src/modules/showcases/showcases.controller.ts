import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ShowcasesService } from './showcases.service';
import { CreateShowcaseDto } from './dto/create-showcase.dto';
import { UpdateShowcaseDto } from './dto/update-showcase.dto';
import { ShowcaseResponseDto } from './dto/showcase-response.dto';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Controller('posts')
export class ShowcasesController {
  constructor(private readonly showcases: ShowcasesService) {}

  @Get()
  async list(
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<{ items: ShowcaseResponseDto[]; total: number }> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.showcases.findAll(undefined, safeLimit, safeOffset);
  }

  @Get(':slug')
  async getOne(@Param('slug') slug: string): Promise<ShowcaseResponseDto> {
    return this.showcases.findOneBySlug(slug, undefined);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async create(
    @Body() dto: CreateShowcaseDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShowcaseResponseDto> {
    return this.showcases.create(dto, request.user.id);
  }

  @Patch(':slug')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateShowcaseDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShowcaseResponseDto> {
    return this.showcases.update(slug, dto, request.user.id);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async remove(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.showcases.remove(slug, request.user.id);
  }
}
