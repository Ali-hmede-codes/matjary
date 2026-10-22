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
import { Showcase, ShowcaseStatus, Store } from '@app/database';
import { CreateShowcaseDto } from './dto/create-showcase.dto';
import { UpdateShowcaseDto } from './dto/update-showcase.dto';
import { ShowcaseResponseDto } from './dto/showcase-response.dto';
import { getMaxPostsPerMonth, isUnlimited } from '@app/config';
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
      const where: Record<string, unknown> = {};
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
      const showcase = await this.showcases.findOneBy({ slug });
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
      const existing = await this.showcases.findOneBy({ slug: dto.slug });
      if (existing) {
        throw new ConflictException('A post with this slug already exists');
      }

      let store: Store | null = null;
      if (dto.storeId) {
        store = await this.stores.findOneBy({ id: dto.storeId });
        if (!store) {
          throw new NotFoundException('Store not found');
        }
        if (store.ownerId !== ownerId) {
          throw new ForbiddenException('You do not own this store');
        }

        // Enforce subscription-based post limits before creating the post.
        const maxPosts = getMaxPostsPerMonth(store.subscriptionTier);
        if (!isUnlimited(store.subscriptionTier)) {
          if (store.postsCountThisMonth >= maxPosts!) {
            throw new ConflictException(
              'Post limit reached for your subscription tier',
            );
          }
        }
      }

      const showcase = this.showcases.create({
        slug: dto.slug,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status ?? ShowcaseStatus.DRAFT,
        ownerId,
        storeId: dto.storeId ?? null,
        publishedAt:
          dto.status === ShowcaseStatus.PUBLISHED ? new Date() : null,
      });

      const saved = await this.showcases.save(showcase);

      // Increment the store's monthly post counter within the same flow.
      if (store) {
        await this.stores.increment({ id: store.id }, 'postsCountThisMonth', 1);
      }

      // Auto-generate SEO for the new showcase
      try {
        await this.seoService.autoGenerateShowcaseSeo(saved, store);
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
      const showcase = await this.showcases.findOneBy({ slug });
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

      const saved = await this.showcases.save(showcase);

      // Get store for SEO if not already loaded
      let store: Store | null = null;
      if (saved.storeId) {
        store = await this.stores.findOneBy({ id: saved.storeId });
      }

      // Auto-regenerate SEO if content changed and notify IndexNow
      try {
        await this.seoService.autoGenerateShowcaseSeo(saved, store);
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
      const showcase = await this.showcases.findOneBy({ slug });
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      if (showcase.ownerId !== userId) {
        throw new ForbiddenException('You do not own this post');
      }

      await this.showcases.remove(showcase);
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
