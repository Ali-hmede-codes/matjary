import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import {
  Product,
  Showcase,
  ShowcaseStatus,
  Store,
  StoreCategory,
  User,
  MediaAsset,
  MediaStatus,
  effectiveLimits,
  assertSubscriptionActive,
  assertQuota,
  contentSectionCaps,
  ownerContentState,
  SECTION_DISABLED_CODE,
  ownerWhere,
  publicWhere,
  lockOwnerContent,
  chooseContentSlug,
  purgeShowcaseRecords,
} from '@app/database';
import { StorageService } from '@app/storage';
import { RedisService } from '@app/queue';
import { forgetEngagement } from '@app/queue/engagement-buffer';
import { CreateShowcaseDto } from './dto/create-showcase.dto';
import { UpdateShowcaseDto } from './dto/update-showcase.dto';
import { ShowcaseResponseDto } from './dto/showcase-response.dto';
import { SeoService } from '../seo/seo.service';
import { deleteStoredObjects } from '../media-cleanup';

@Injectable()
export class ShowcasesService {
  private readonly logger = new Logger(ShowcasesService.name);

  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(StoreCategory)
    private readonly categories: Repository<StoreCategory>,
    private readonly seoService: SeoService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  private sanitize(error: unknown): never {
    throw new ServiceUnavailableException(
      'Post storage is temporarily unavailable',
    );
  }

  /**
   * A shoppable post may point at one product or one category, and only rows
   * that belong to the post's own shop — a link must never leak another shop's
   * catalogue into the post.
   */
  private async resolveLinks(
    storeId: string | null,
    linkedProductId: string | null | undefined,
    linkedCategoryId: string | null | undefined,
  ): Promise<{ productId: string | null; categoryId: string | null }> {
    const productId = linkedProductId ?? null;
    const categoryId = linkedCategoryId ?? null;
    if (productId && categoryId) {
      throw new BadRequestException(
        'A post can link one item or one section, not both',
      );
    }
    if ((productId || categoryId) && !storeId) {
      throw new BadRequestException('Link a shop post before adding an item');
    }
    if (productId) {
      const product = await this.products.findOneBy({ id: productId });
      if (!product || product.storeId !== storeId || product.adminArchivedAt) {
        throw new NotFoundException('Product not found');
      }
    }
    if (categoryId) {
      const category = await this.categories.findOneBy({ id: categoryId });
      if (!category || category.storeId !== storeId) {
        throw new NotFoundException('Category not found');
      }
    }
    return { productId, categoryId };
  }

  async findAll(
    ownerId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: ShowcaseResponseDto[]; total: number }> {
    try {
      const where: Record<string, unknown> = {
        ...(ownerId ? ownerWhere('post') : publicWhere('post')),
      };
      if (ownerId) {
        where.ownerId = ownerId;
      } else {
        where.status = ShowcaseStatus.PUBLISHED;
      }

      const [items, total] = await this.showcases.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
        select: [
          'id',
          'slug',
          'title',
          'description',
          'status',
          'publishedAt',
          'createdAt',
          'updatedAt',
          'ownerId',
          'linkedProductId',
          'linkedCategoryId',
        ],
      });

      return {
        items: items.map((item) => this.toResponseDto(item, !!ownerId)),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async findOneBySlug(
    slug: string,
    userId: string | undefined,
  ): Promise<ShowcaseResponseDto> {
    try {
      const publicItem = {
        slug,
        status: ShowcaseStatus.PUBLISHED,
        ...publicWhere('post'),
      };
      const showcase = await this.showcases.findOneBy(
        userId
          ? [publicItem, { slug, ownerId: userId, ...ownerWhere('post') }]
          : publicItem,
      );
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      // Public viewers only see published posts. Owners see their own posts.
      if (
        showcase.status !== ShowcaseStatus.PUBLISHED &&
        showcase.ownerId !== userId
      ) {
        throw new NotFoundException('Post not found');
      }

      return this.toResponseDto(showcase, userId === showcase.ownerId);
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

  async create(
    dto: CreateShowcaseDto,
    ownerId: string,
  ): Promise<ShowcaseResponseDto> {
    try {
      const { saved, store } = await this.showcases.manager.transaction(
        async (manager) => {
          await manager.findOneOrFail(User, {
            where: { id: ownerId },
            lock: { mode: 'pessimistic_write' },
          });
          await assertSubscriptionActive(manager, ownerId);
          const limits = await effectiveLimits(manager, ownerId);

          let store: Store | null = null;
          if (dto.storeId) {
            store = await manager.findOneBy(Store, {
              id: dto.storeId,
              ...ownerWhere('store'),
            });
            if (!store) {
              throw new NotFoundException('Store not found');
            }
            if (store.ownerId !== ownerId) {
              throw new ForbiddenException('You do not own this store');
            }
            if (!store.enablePostsSection) {
              throw new ConflictException({ code: SECTION_DISABLED_CODE });
            }
          }

          // A turned-off section donates only its unused allowance to the
          // section that stays on. Posts without a shop follow the account-wide
          // setting, so "off in every shop" also blocks them here.
          const sections = await ownerContentState(manager, ownerId);
          if (!store && !sections.availability.posts) {
            throw new ConflictException({ code: SECTION_DISABLED_CODE });
          }
          const caps = contentSectionCaps(
            limits,
            sections.usage,
            sections.availability,
          );
          assertQuota(sections.usage.posts, caps.posts, 'Post');

          const slug = await chooseContentSlug(dto.title, dto.slug, (value) =>
            manager.getRepository(Showcase).findOneBy({ slug: value }),
          );
          const existing = await manager.findOneBy(Showcase, {
            slug,
          });
          if (existing) {
            throw new ConflictException('A post with this slug already exists');
          }

          const link = await this.resolveLinks(
            dto.storeId ?? null,
            dto.linkedProductId,
            dto.linkedCategoryId,
          );

          const showcase = manager.create(Showcase, {
            slug,
            title: dto.title,
            description: dto.description ?? null,
            status: dto.status ?? ShowcaseStatus.DRAFT,
            ownerId,
            storeId: dto.storeId ?? null,
            linkedProductId: link.productId,
            linkedCategoryId: link.categoryId,
            publishedAt:
              dto.status === ShowcaseStatus.PUBLISHED ? new Date() : null,
          });

          const saved = await manager.save(showcase);
          return { saved, store };
        },
      );

      // Auto-generate SEO for the new showcase
      try {
        await this.seoService.autoGenerateOwnedSeo(
          'showcase',
          saved.id,
          saved.ownerId,
        );
      } catch (error) {
        // SEO generation failure shouldn't break showcase creation
        this.logger.warn('Failed to auto-generate showcase SEO:', error);
      }

      return this.toResponseDto(saved, true);
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
        throw new ConflictException('A post with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  async update(
    slug: string,
    dto: UpdateShowcaseDto,
    userId: string,
  ): Promise<ShowcaseResponseDto> {
    try {
      const showcase = await this.showcases.findOneBy({
        slug,
        ...ownerWhere('post'),
      });
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      if (showcase.ownerId !== userId) {
        throw new ForbiddenException('You do not own this post');
      }

      if (dto.title !== undefined) showcase.title = dto.title;
      if (dto.description !== undefined) showcase.description = dto.description;
      if (dto.status !== undefined) {
        showcase.status = dto.status;
        if (dto.status === ShowcaseStatus.PUBLISHED && !showcase.publishedAt) {
          showcase.publishedAt = new Date();
        }
      }
      if (dto.publishedAt !== undefined) {
        showcase.publishedAt = dto.publishedAt
          ? new Date(dto.publishedAt)
          : null;
      }
      if (
        dto.linkedProductId !== undefined ||
        dto.linkedCategoryId !== undefined
      ) {
        let productId =
          dto.linkedProductId === undefined
            ? showcase.linkedProductId
            : dto.linkedProductId;
        let categoryId =
          dto.linkedCategoryId === undefined
            ? showcase.linkedCategoryId
            : dto.linkedCategoryId;
        // Choosing a new link replaces the other kind instead of stacking two.
        if (dto.linkedProductId) categoryId = null;
        if (dto.linkedCategoryId) productId = null;
        const link = await this.resolveLinks(
          showcase.storeId,
          productId,
          categoryId,
        );
        showcase.linkedProductId = link.productId;
        showcase.linkedCategoryId = link.categoryId;
      }

      const saved = await this.showcases.manager.transaction(
        async (manager) => {
          await lockOwnerContent(manager, 'post', showcase.id, userId);
          await assertSubscriptionActive(manager, userId);
          return manager.save(showcase);
        },
      );

      // Get store for SEO if not already loaded
      let store: Store | null = null;
      if (saved.storeId) {
        store = await this.stores.findOneBy({ id: saved.storeId });
      }

      // Auto-regenerate SEO if content changed and notify IndexNow
      try {
        await this.seoService.autoGenerateOwnedSeo(
          'showcase',
          saved.id,
          saved.ownerId,
        );
        await this.seoService.notifyIndexNowOnChange('showcase', saved);
      } catch (error) {
        // SEO generation failure shouldn't break showcase update
        this.logger.warn('Failed to auto-generate showcase SEO:', error);
      }

      return this.toResponseDto(saved, true);
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
        throw new ConflictException('A post with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  async remove(slug: string, userId: string): Promise<void> {
    let deleted: { id: string; keys: string[] } | undefined;
    try {
      const showcase = await this.showcases.findOneBy({
        slug,
        ...ownerWhere('post'),
      });
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      if (showcase.ownerId !== userId) {
        throw new ForbiddenException('You do not own this post');
      }

      deleted = await this.showcases.manager.transaction(async (manager) => {
        await lockOwnerContent(manager, 'post', showcase.id, userId);
        // An active encode keeps writing variants for the asset rows this
        // deletion removes. Ask the owner to wait for that job instead of
        // leaving orphaned files and a job that keeps failing.
        const processing = await manager.countBy(MediaAsset, {
          showcaseId: showcase.id,
          status: MediaStatus.PROCESSING,
        });
        if (processing)
          throw new ConflictException(
            'Wait for media processing to finish before deleting this post',
          );
        const keys = await purgeShowcaseRecords(manager, showcase.id);
        return { id: showcase.id, keys };
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
    if (!deleted) return;
    // Bytes and buffered engagement go only after the rows are gone, and a
    // cleanup hiccup must not report a committed deletion as failed.
    await deleteStoredObjects(this.storage, deleted.keys);
    await forgetEngagement(this.redis, deleted.id).catch(() =>
      this.logger.warn('Could not clear engagement state for a deleted post'),
    );
  }

  private toResponseDto(
    showcase: Showcase,
    includeOwnerId = false,
  ): ShowcaseResponseDto {
    return {
      id: showcase.id,
      slug: showcase.slug,
      title: showcase.title,
      description: showcase.description,
      status: showcase.status,
      publishedAt: showcase.publishedAt,
      createdAt: showcase.createdAt,
      updatedAt: showcase.updatedAt,
      ...(includeOwnerId ? { ownerId: showcase.ownerId } : {}),
      linkedProductId: showcase.linkedProductId,
      linkedCategoryId: showcase.linkedCategoryId,
    };
  }
}
