import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import {
  Product,
  Store,
  StoreCategory,
  User,
  assertQuota,
  assertSubscriptionActive,
  effectiveLimits,
  ownerWhere,
  publicWhere,
} from '@app/database';
import {
  CategoryListResponseDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(StoreCategory)
    private readonly categories: Repository<StoreCategory>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (
        error as QueryFailedError & { driverError?: { code?: string } }
      ).driverError?.code;
      if (code === 'ER_DUP_ENTRY')
        throw new ConflictException('A category with this name already exists');
      if (code === 'ER_ROW_IS_REFERENCED_2')
        throw new ConflictException(
          'Move or delete this category’s products first',
        );
    }
    throw new ServiceUnavailableException(
      'Category storage is temporarily unavailable',
    );
  }

  private async publicStore(slug: string): Promise<Store> {
    const store = await this.stores.findOneBy({
      slug,
      ...publicWhere('store'),
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async ownedStore(
    manager: EntityManager,
    slug: string,
    userId: string,
  ): Promise<Store> {
    const store = await manager.findOne(Store, {
      where: { slug, ownerId: userId, ...ownerWhere('store') },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async lockOwner(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const owner = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!owner || owner.suspendedAt)
      throw new NotFoundException('Store not found');
  }

  async listPublic(slug: string): Promise<CategoryListResponseDto> {
    try {
      const store = await this.publicStore(slug);
      const items = await this.categories.find({
        where: { storeId: store.id },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      return {
        items: items.map((category) =>
          CategoryResponseDto.fromEntity(category),
        ),
        total: items.length,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async listOwned(
    slug: string,
    userId: string,
  ): Promise<CategoryListResponseDto> {
    try {
      const store = await this.ownedStore(this.stores.manager, slug, userId);
      const [items, counts, limits] = await Promise.all([
        this.categories.find({
          where: { storeId: store.id },
          order: { sortOrder: 'ASC', name: 'ASC' },
        }),
        this.productCounts(store.id),
        effectiveLimits(this.stores.manager, userId),
      ]);
      return {
        items: items.map((category) =>
          CategoryResponseDto.fromEntity(category, counts[category.id] ?? 0),
        ),
        total: items.length,
        limit: limits.maxCategories ?? null,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async create(
    dto: CreateCategoryDto,
    slug: string,
    userId: string,
  ): Promise<CategoryResponseDto> {
    try {
      const saved = await this.categories.manager.transaction(
        async (manager) => {
          await this.lockOwner(manager, userId);
          await assertSubscriptionActive(manager, userId);
          const store = await this.ownedStore(manager, slug, userId);
          const limits = await effectiveLimits(manager, userId);
          // The quota covers every owned shop, including shops in Trash, so
          // restoring a shop can never exceed the plan it was created under.
          const count = await manager.count(StoreCategory, {
            where: { store: { ownerId: userId } },
          });
          assertQuota(count, limits.maxCategories, 'Category');
          const name = dto.name.trim();
          if (!name) throw new BadRequestException('Category name is required');
          const duplicate = await manager.findOneBy(StoreCategory, {
            storeId: store.id,
            name,
          });
          if (duplicate)
            throw new ConflictException(
              'A category with this name already exists',
            );
          const last = await manager.findOne(StoreCategory, {
            where: { storeId: store.id },
            order: { sortOrder: 'DESC' },
          });
          return manager.save(
            manager.create(StoreCategory, {
              storeId: store.id,
              name,
              sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 0),
            }),
          );
        },
      );
      return CategoryResponseDto.fromEntity(saved, 0);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async update(
    categoryId: string,
    dto: UpdateCategoryDto,
    slug: string,
    userId: string,
  ): Promise<CategoryResponseDto> {
    try {
      const saved = await this.categories.manager.transaction(
        async (manager) => {
          await this.lockOwner(manager, userId);
          await assertSubscriptionActive(manager, userId);
          const store = await this.ownedStore(manager, slug, userId);
          const category = await manager.findOneBy(StoreCategory, {
            id: categoryId,
            storeId: store.id,
          });
          if (!category) throw new NotFoundException('Category not found');
          if (dto.name !== undefined) {
            const name = dto.name.trim();
            if (!name)
              throw new BadRequestException('Category name is required');
            const duplicate = await manager.findOne(StoreCategory, {
              where: { storeId: store.id, name },
            });
            if (duplicate && duplicate.id !== category.id)
              throw new ConflictException(
                'A category with this name already exists',
              );
            category.name = name;
          }
          if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
          return manager.save(category);
        },
      );
      return CategoryResponseDto.fromEntity(saved);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async remove(
    categoryId: string,
    slug: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.categories.manager.transaction(async (manager) => {
        await this.lockOwner(manager, userId);
        const store = await this.ownedStore(manager, slug, userId);
        const category = await manager.findOneBy(StoreCategory, {
          id: categoryId,
          storeId: store.id,
        });
        if (!category) throw new NotFoundException('Category not found');
        const used = await manager.count(Product, {
          where: { categoryId: category.id },
        });
        // Products are never silently recategorized; the owner decides first.
        if (used)
          throw new ConflictException(
            'Move or delete this category’s products first',
          );
        await manager.remove(category);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  private async productCounts(
    storeId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.products
      .createQueryBuilder('product')
      .select('product.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('product.storeId = :storeId', { storeId })
      .andWhere('product.categoryId IS NOT NULL')
      .groupBy('product.categoryId')
      .getRawMany<{ categoryId: string; count: string }>();
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.categoryId] = parseInt(row.count, 10);
    return counts;
  }
}
