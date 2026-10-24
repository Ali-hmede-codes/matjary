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
  Showcase,
  ShowcaseStatus,
  Store,
  User,
  effectiveLimits,
  assertQuota,
  ownerWhere,
  publicWhere,
  lockOwnerContent,
  chooseContentSlug,
} from '@app/database';
import { CreateShowcaseDto } from './dto/create-showcase.dto';
import { UpdateShowcaseDto } from './dto/update-showcase.dto';
import { ShowcaseResponseDto } from './dto/showcase-response.dto';
import { SeoService } from '../seo/seo.service';

@Injectable()
export class ShowcasesService {
  private readonly logger = new Logger(ShowcasesService.name);

  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    private readonly seoService: SeoService,
  ) {}

  private sanitize(error: unknown): never {
    throw new ServiceUnavailableException(
      'Post storage is temporarily unavailable',
    );
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
          const limits = await effectiveLimits(manager, ownerId);
          const now = new Date();
          const start = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
          );
          const end = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
          );
          const total = await manager.countBy(Showcase, { ownerId });
          const monthly = await manager
            .getRepository(Showcase)
            .createQueryBuilder('post')
            .where(
              'post.ownerId = :ownerId AND post.createdAt >= :start AND post.createdAt < :end',
              { ownerId, start, end },
            )
            .getCount();
          assertQuota(total, limits.maxTotalPosts, 'Total post');
          assertQuota(monthly, limits.maxPostsPerMonth, 'Monthly post');
          const slug = await chooseContentSlug(dto.title, dto.slug, (value) =>
            manager.getRepository(Showcase).findOneBy({ slug: value }),
          );
          const existing = await manager.findOneBy(Showcase, {
            slug,
          });
          if (existing) {
            throw new ConflictException('A post with this slug already exists');
          }

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
          }

          const showcase = manager.create(Showcase, {
            slug,
            title: dto.title,
            description: dto.description ?? null,
            status: dto.status ?? ShowcaseStatus.DRAFT,
            ownerId,
            storeId: dto.storeId ?? null,
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
        error instanceof ForbiddenException
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

      const saved = await this.showcases.manager.transaction(
        async (manager) => {
          await lockOwnerContent(manager, 'post', showcase.id, userId);
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
        error instanceof ConflictException
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

      await this.showcases.manager.transaction(async (manager) => {
        await lockOwnerContent(manager, 'post', showcase.id, userId);
        await manager.remove(showcase);
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
    };
  }
}
