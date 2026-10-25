import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import {
  Store,
  StoreCategory,
  Product,
  ProductStatus,
  ProductCategory,
  User,
  effectiveLimits,
  assertSubscriptionActive,
  assertQuota,
  ownerWhere,
  publicWhere,
  lockOwnerContent,
  chooseContentSlug,
  assertMediaAttachment,
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
      const where: Record<string, unknown> = { ...publicWhere('product') };
      if (storeId) where.storeId = storeId;
      if (status) where.status = status;
      if (category) where.category = category;

      const [items, total] = await this.products.findAndCount({
        where,
        relations: ['categoryRef'],
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
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...publicWhere('store'),
      });
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
      const publicItem = {
        slug,
        status: ProductStatus.ACTIVE,
        ...publicWhere('product'),
      };
      const product = await this.products.findOne({
        where: userId
          ? [
              publicItem,
              { slug, store: { ownerId: userId }, ...ownerWhere('product') },
            ]
          : publicItem,
        relations: ['categoryRef'],
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // For non-active products, only allow owner to see
      if (product.status !== ProductStatus.ACTIVE) {
        const store = await this.stores.findOneBy({
          id: product.storeId,
          ...ownerWhere('store'),
        });
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
      const { saved, store, categoryName } =
        await this.products.manager.transaction(async (manager) => {
          await manager.findOneOrFail(User, {
            where: { id: userId },
            lock: { mode: 'pessimistic_write' },
          });
          await assertSubscriptionActive(manager, userId);
          const limits = await effectiveLimits(manager, userId);
          const count = await manager.count(Product, {
            where: { store: { ownerId: userId } },
          });
          assertQuota(count, limits.maxProducts, 'Product');
          const store = await manager.findOneBy(Store, {
            id: storeId,
            ...ownerWhere('store'),
          });
          if (!store) {
            throw new NotFoundException('Store not found');
          }
          if (store.ownerId !== userId) {
            throw new ForbiddenException('You do not own this store');
          }

          const category = dto.categoryId
            ? await manager.findOneBy(StoreCategory, {
                id: dto.categoryId,
                storeId,
              })
            : null;
          if (dto.categoryId && !category)
            throw new BadRequestException('Category not found for this store');

          const slug = await chooseContentSlug(dto.name, dto.slug, (value) =>
            manager.getRepository(Product).findOneBy({ slug: value }),
          );
          const existing = await manager.findOneBy(Product, { slug });
          if (existing) {
            throw new ConflictException(
              'A product with this slug already exists',
            );
          }

          if (dto.imageKeys?.length)
            throw new ConflictException(
              'Save the product before uploading its photos',
            );
          const product = manager.create(Product, {
            slug,
            name: dto.name,
            description: dto.description ?? null,
            priceCents: dto.priceCents.toString(),
            currency: dto.currency ?? 'USD',
            category: dto.category ?? ProductCategory.OTHER,
            categoryId: category?.id ?? null,
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
          return { saved, store, categoryName: category?.name ?? null };
        });

      // Auto-generate SEO for the new product
      try {
        await this.seoService.autoGenerateOwnedSeo('product', saved.id, userId);
      } catch (error) {
        // SEO generation failure shouldn't break product creation
        this.logger.warn('Failed to auto-generate product SEO:', error);
      }

      return toProductResponseDto(saved, categoryName);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
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
      const product = await this.products.findOneBy({
        slug,
        ...ownerWhere('product'),
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Verify user owns the store
      const store = await this.stores.findOneBy({
        id: product.storeId,
        ...ownerWhere('store'),
      });
      if (!store || store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this product');
      }

      await assertMediaAttachment(
        this.products.manager,
        userId,
        'product_image',
        product.id,
        dto.imageKeys ?? [],
        product.imageKeys ?? [],
      );
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

      const { saved, categoryName } = await this.products.manager.transaction(
        async (manager) => {
          await lockOwnerContent(manager, 'product', product.id, userId);
          await assertSubscriptionActive(manager, userId);
          let categoryName: string | null = null;
          if (dto.categoryId === null) {
            product.categoryId = null;
          } else if (dto.categoryId !== undefined) {
            const category = await manager.findOneBy(StoreCategory, {
              id: dto.categoryId,
              storeId: product.storeId,
            });
            if (!category)
              throw new BadRequestException(
                'Category not found for this store',
              );
            product.categoryId = category.id;
            categoryName = category.name;
          } else if (product.categoryId) {
            categoryName =
              (
                await manager.findOneBy(StoreCategory, {
                  id: product.categoryId,
                  storeId: product.storeId,
                })
              )?.name ?? null;
          }
          return { saved: await manager.save(product), categoryName };
        },
      );

      // Auto-regenerate SEO if content changed and notify IndexNow
      try {
        await this.seoService.autoGenerateOwnedSeo('product', saved.id, userId);
        await this.seoService.notifyIndexNowOnChange('product', saved);
      } catch (error) {
        // SEO generation failure shouldn't break product update
        this.logger.warn('Failed to auto-generate product SEO:', error);
      }

      return toProductResponseDto(saved, categoryName);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
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
      const product = await this.products.findOneBy({
        slug,
        ...ownerWhere('product'),
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Verify user owns the store
      const store = await this.stores.findOneBy({
        id: product.storeId,
        ...ownerWhere('store'),
      });
      if (!store || store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this product');
      }

      await this.products.manager.transaction(async (manager) => {
        await lockOwnerContent(manager, 'product', product.id, userId);
        await manager.remove(product);
      });
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
      const store = await this.stores.findOneBy({
        id: storeId,
        ...ownerWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }
      if (store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this store');
      }

      const products = await this.products.find({
        where: { storeId, ...ownerWhere('product') },
        relations: ['categoryRef'],
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      });

      return products.map((product) => toProductResponseDto(product));
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
