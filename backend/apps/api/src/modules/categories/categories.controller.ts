import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import {
  CategoryListResponseDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/guards/auth.guards';

@Controller('stores/:storeSlug/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Public storefront listing: every shop type can expose its own categories.
  @Get()
  listPublic(
    @Param('storeSlug') storeSlug: string,
  ): Promise<CategoryListResponseDto> {
    return this.categories.listPublic(storeSlug);
  }

  // Owner view adds product counts and the account-wide plan allowance.
  @Get('my')
  @UseGuards(SessionGuard)
  listOwned(
    @Param('storeSlug') storeSlug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CategoryListResponseDto> {
    return this.categories.listOwned(storeSlug, request.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  create(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CreateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CategoryResponseDto> {
    return this.categories.create(dto, storeSlug, request.user.id);
  }

  @Patch(':categoryId')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  update(
    @Param('storeSlug') storeSlug: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CategoryResponseDto> {
    return this.categories.update(categoryId, dto, storeSlug, request.user.id);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async remove(
    @Param('storeSlug') storeSlug: string,
    @Param('categoryId') categoryId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.categories.remove(categoryId, storeSlug, request.user.id);
  }
}
