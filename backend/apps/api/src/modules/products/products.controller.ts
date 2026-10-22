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
import { ProductsService } from './products.service';
import { StoresService } from '../stores/stores.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ProductResponseDto,
  ProductListResponseDto,
} from './dto/product-response.dto';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AuthenticatedRequest,
  OptionalSessionGuard,
} from '../auth/guards/auth.guards';
import { ProductStatus, ProductCategory } from '@app/database';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Controller('stores/:storeSlug/products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly stores: StoresService,
  ) {}

  @Get()
  async listByStore(
    @Param('storeSlug') storeSlug: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
    @Query('status') status?: ProductStatus,
    @Query('category') category?: ProductCategory,
  ): Promise<ProductListResponseDto> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.products.findByStoreSlug(
      storeSlug,
      safeLimit,
      safeOffset,
      ProductStatus.ACTIVE,
      category,
    );
  }

  @Get('my')
  @UseGuards(SessionGuard)
  async getMyStoreProducts(
    @Param('storeSlug') storeSlug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductResponseDto[]> {
    const store = await this.stores.findStoreEntityBySlug(storeSlug);
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    if (store.ownerId !== request.user.id) {
      throw new ForbiddenException('You do not own this store');
    }
    return this.products.getStoreProducts(store.id, request.user.id);
  }

  @Get(':slug')
  @UseGuards(OptionalSessionGuard)
  async getOne(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
  ): Promise<ProductResponseDto> {
    const userId = 'user' in request ? request.user?.id : undefined;
    return this.products.findOneBySlug(slug, userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async create(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CreateProductDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductResponseDto> {
    const store = await this.stores.findStoreEntityBySlug(storeSlug);
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    if (store.ownerId !== request.user.id) {
      throw new ForbiddenException('You do not own this store');
    }
    return this.products.create(dto, store.id, request.user.id);
  }

  @Patch(':slug')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateProductDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductResponseDto> {
    return this.products.update(slug, dto, request.user.id);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async remove(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.products.remove(slug, request.user.id);
  }
}
