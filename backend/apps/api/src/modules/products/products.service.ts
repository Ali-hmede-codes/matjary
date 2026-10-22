import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import {
  Store,
  Product,
  ProductStatus,
  ProductCategory,
  User,
  effectiveLimits,
  assertQuota,
} from '@app/database';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ProductResponseDto,
  toProductResponseDto,
  ProductListResponseDto,
} from './dto/product-response.dto';
import { SeoService } from '../seo/seo.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly seoService: SeoService,
  ) {}

  private sanitize(error: unknown): never {
    throw new ServiceUnavailableException(
      'Product storage is temporarily unavailable',
    );
  }

  async findAll(
    storeId: string | undefined,
    limit: number,
    offset: number,
    status?: ProductStatus,
    category?: ProductCategory,
  ): Promise<ProductListResponseDto> {
    try {
      const where: Record<string, unknown> = {};
      if (storeId) where.storeId = storeId;
      if (status) where.status = status;
      if (category) where.category = category;

      const [items, total] = await this.products.findAndCount({
        where,
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });

      return {
        items: items.map((item) => toProductResponseDto(item)),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async findByStoreSlug(
    storeSlug: string,
    limit: number,
    offset: number,
    status?: ProductStatus,
    category?: ProductCategory,
  ): Promise<ProductListResponseDto> {
    try {
      const store = await this.stores.findOneBy({ slug: storeSlug });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      return this.findAll(store.id, limit, offset, status, category);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async findOneBySlug(
    slug: string,
    userId: string | undefined,
  ): Promise<ProductResponseDto> {
    try {
      const product = await this.products.findOneBy({ slug });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // For non-active products, only allow owner to see
      if (product.status !== ProductStatus.ACTIVE) {
        const store = await this.stores.findOneBy({ id: product.storeId });
        if (!store || store.ownerId !== userId) {
          throw new NotFoundException('Product not found');
        }
      }

      return toProductResponseDto(product);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async create(
    dto: CreateProductDto,
    storeId: string,
    userId: string,
  ): Promise<ProductResponseDto> {
    try {
      const { saved, store } = await this.products.manager.transaction(
        async (manager) => {
          await manager.findOneOrFail(User, {
            where: { id: userId },
            lock: { mode: 'pessimistic_write' },
          });
          const limits = await effectiveLimits(manager, userId);
          const count = await manager.count(Product, {
            where: { store: { ownerId: userId } },
          });
          assertQuota(count, limits.maxProducts, 'Product');
          const store = await manager.findOneBy(Store, { id: storeId });
          if (!store) {
            throw new NotFoundException('Store not found');
          }
          if (store.ownerId !== userId) {
            throw new ForbiddenException('You do not own this store');
          }

          const existing = await manager.findOneBy(Product, { slug: dto.slug });
          if (existing) {
            throw new ConflictException(
              'A product with this slug already exists',
            );
          }

          const product = manager.create(Product, {
            slug: dto.slug,
            name: dto.name,
            description: dto.description ?? null,
            priceCents: dto.priceCents.toString(),
            currency: dto.currency ?? 'USD',
            category: dto.category ?? ProductCategory.OTHER,
            status: dto.status ?? ProductStatus.DRAFT,
            sku: dto.sku ?? null,
            stockQuantity: dto.stockQuantity ?? null,
            weightGrams: dto.weightGrams ?? null,
            imageKeys: dto.imageKeys ?? null,
            tags: dto.tags ?? null,
            sortOrder: dto.sortOrder ?? 0,
            requiresShipping: dto.requiresShipping ?? true,
            storeId,
          });

          const saved = await manager.save(product);
          return { saved, store };
        },
      );

      // Auto-generate SEO for the new product
      try {
        await this.seoService.autoGenerateProductSeo(saved, store);
      } catch (error) {
        // SEO generation failure shouldn't break product creation
        this.logger.warn('Failed to auto-generate product SEO:', error);
      }

      return toProductResponseDto(saved);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('A product with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  async update(
    slug: string,
    dto: UpdateProductDto,
    userId: string,
  ): Promise<ProductResponseDto> {
    try {
      const product = await this.products.findOneBy({ slug });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Verify user owns the store
      const store = await this.stores.findOneBy({ id: product.storeId });
      if (!store || store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this product');
      }

      if (dto.name !== undefined) product.name = dto.name;
      if (dto.description !== undefined) product.description = dto.description;
      if (dto.priceCents !== undefined)
        product.priceCents = dto.priceCents.toString();
      if (dto.currency !== undefined) product.currency = dto.currency;
      if (dto.category !== undefined) product.category = dto.category;
      if (dto.status !== undefined) product.status = dto.status;
      if (dto.sku !== undefined) product.sku = dto.sku;
      if (dto.stockQuantity !== undefined)
        product.stockQuantity = dto.stockQuantity;
      if (dto.weightGrams !== undefined) product.weightGrams = dto.weightGrams;
      if (dto.imageKeys !== undefined) product.imageKeys = dto.imageKeys;
      if (dto.tags !== undefined) product.tags = dto.tags;
      if (dto.sortOrder !== undefined) product.sortOrder = dto.sortOrder;
      if (dto.requiresShipping !== undefined)
        product.requiresShipping = dto.requiresShipping;

      const saved = await this.products.save(product);

      // Auto-regenerate SEO if content changed and notify IndexNow
      try {
        await this.seoService.autoGenerateProductSeo(saved, store);
        await this.seoService.notifyIndexNowOnChange('product', saved);
      } catch (error) {
        // SEO generation failure shouldn't break product update
        this.logger.warn('Failed to auto-generate product SEO:', error);
      }

      return toProductResponseDto(saved);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('A product with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  async remove(slug: string, userId: string): Promise<void> {
    try {
      const product = await this.products.findOneBy({ slug });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Verify user owns the store
      const store = await this.stores.findOneBy({ id: product.storeId });
      if (!store || store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this product');
      }

      await this.products.remove(product);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async getStoreProducts(
    storeId: string,
    userId: string,
  ): Promise<ProductResponseDto[]> {
    try {
      const store = await this.stores.findOneBy({ id: storeId });
      if (!store) {
        throw new NotFoundException('Store not found');
      }
      if (store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this store');
      }

      const products = await this.products.find({
        where: { storeId },
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      });

      return products.map(toProductResponseDto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }
}
