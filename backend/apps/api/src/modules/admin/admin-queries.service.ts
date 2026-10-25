import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, type EntityTarget, type ObjectLiteral } from 'typeorm';
import {
  AdminAuditLog,
  BoostCampaign,
  BoostCoin,
  BoostTransaction,
  Cart,
  CartItem,
  MediaAsset,
  MediaVariant,
  Product,
  Showcase,
  Store,
  SubscriptionPlan,
  SystemErrorRecord,
  User,
  UserRole,
  isAdminUser,
  isAdminEmail,
  UserSubscription,
  SeoRedirect,
  type AdminActor,
} from '@app/database';
import { AdminAccessService } from './admin-access.service';
import { AdminListDto } from './admin.dto';

interface Resource {
  target: EntityTarget<ObjectLiteral>;
  fields: string[];
  search: string[];
  owner?: string;
  parent?: string;
  archive?: string;
  status?: string;
  key?: string;
  date?: string;
}
const fields = (text: string) => text.split(' ');
export const ADMIN_RESOURCES: Record<string, Resource> = {
  users: {
    target: User,
    fields: fields('id email displayName role suspendedAt createdAt updatedAt'),
    search: ['email', 'displayName'],
    archive: 'suspendedAt',
  },
  stores: {
    target: Store,
    fields: fields(
      'id ownerId name slug status trashedAt description brandColor storeType socialMediaLinks logoKey bannerKey enableCart enableWhatsAppCheckout designSettings latitude longitude address city country postalCode locationName phone website openingHours hasVerificationBadge verificationBadgeExpiresAt adminArchivedAt createdAt updatedAt',
    ),
    search: ['name', 'slug'],
    owner: 'ownerId',
    archive: 'adminArchivedAt',
  },
  products: {
    target: Product,
    fields: fields(
      'id storeId slug name description priceCents currency category categoryId status sku stockQuantity weightGrams imageKeys tags sortOrder requiresShipping adminArchivedAt createdAt updatedAt',
    ),
    search: ['name', 'slug'],
    parent: 'storeId',
    archive: 'adminArchivedAt',
    status: 'status',
  },
  posts: {
    target: Showcase,
    fields: fields(
      'id ownerId storeId slug title description status publishedAt mediaCount likesCount viewsCount adminArchivedAt createdAt updatedAt',
    ),
    search: ['title', 'slug'],
    owner: 'ownerId',
    parent: 'storeId',
    archive: 'adminArchivedAt',
    status: 'status',
  },
  media: {
    target: MediaAsset,
    fields: fields(
      'id showcaseId storeId productId purpose kind status mimeType sizeBytes width height durationMs altText position adminArchivedAt createdAt updatedAt',
    ),
    search: ['id', 'altText'],
    parent: 'showcaseId',
    archive: 'adminArchivedAt',
    status: 'status',
  },
  plans: {
    target: SubscriptionPlan,
    fields: fields(
      'id name slug description priceCents currency billingCycle limits isActive sortOrder legacyTier createdAt updatedAt',
    ),
    search: ['name', 'slug'],
  },
  subscriptions: {
    target: UserSubscription,
    fields: fields(
      'id userId planId status startsAt expiresAt assignedBy notes createdAt updatedAt',
    ),
    search: ['id'],
    owner: 'userId',
    parent: 'planId',
    status: 'status',
  },
  campaigns: {
    target: BoostCampaign,
    fields: fields(
      'id userId name targetType targetStoreId targetShowcaseId status budgetCoins spentCoins dailyBudgetCoins bidStrategy bidAmountCoins targeting creative startAt endAt pausedAt rejectedAt rejectionReason completedAt createdAt updatedAt',
    ),
    search: ['name'],
    owner: 'userId',
    status: 'status',
  },
  wallets: {
    target: BoostCoin,
    fields: fields('userId balance updatedAt'),
    search: ['userId'],
    owner: 'userId',
    key: 'userId',
    date: 'updatedAt',
  },
  transactions: {
    target: BoostTransaction,
    fields: fields(
      'id userId operationId type amount balanceBefore balanceAfter referenceId referenceType description createdAt',
    ),
    search: ['id', 'operationId'],
    owner: 'userId',
  },
  carts: {
    target: Cart,
    fields: fields(
      'id userId storeId status currency customerNotes expiresAt createdAt updatedAt',
    ),
    search: ['id'],
    owner: 'userId',
    parent: 'storeId',
    status: 'status',
  },
  redirects: {
    target: SeoRedirect,
    fields: fields(
      'id fromPath toPath statusCode isActive storeId createdAt updatedAt',
    ),
    search: ['fromPath', 'toPath'],
    parent: 'storeId',
  },
  audit: {
    target: AdminAuditLog,
    fields: fields(
      'id actorId action resource resourceId requestId reason changedFields createdAt',
    ),
    search: ['action', 'resource', 'resourceId', 'requestId'],
    owner: 'actorId',
  },
  errors: {
    target: SystemErrorRecord,
    fields: fields(
      'id service operation code severity state occurrences requestIds firstSeenAt lastSeenAt',
    ),
    search: ['operation', 'code'],
    status: 'state',
    date: 'lastSeenAt',
  },
};

@Injectable()
export class AdminQueriesService {
  constructor(private readonly access: AdminAccessService) {}

  private withUserRole(item: ObjectLiteral) {
    return {
      ...item,
      role: isAdminUser(item, this.access.allowlist)
        ? UserRole.ADMIN
        : UserRole.USER,
      roleManagedByEnvironment: isAdminEmail(item.email, this.access.allowlist),
    };
  }

  private resource(name: string): Resource {
    if (!Object.hasOwn(ADMIN_RESOURCES, name))
      throw new NotFoundException('Administrative resource not found');
    return ADMIN_RESOURCES[name]!;
  }

  async list(name: string, dto: AdminListDto, actor: AdminActor) {
    await this.access.check(actor);
    const resource = this.resource(name);
    const query = this.access.database
      .getRepository(resource.target)
      .createQueryBuilder('item')
      .select(resource.fields.map((field) => `item.${field}`));
    if (name === 'subscriptions')
      query
        .leftJoin(User, 'searchOwner', 'searchOwner.id = item.userId')
        .leftJoin(
          SubscriptionPlan,
          'searchPlan',
          'searchPlan.id = item.planId',
        );
    if (dto.search) {
      const search = `%${dto.search.replace(/[\\%_]/g, '\\$&')}%`;
      query.andWhere(
        name === 'subscriptions'
          ? '(searchOwner.displayName LIKE :search OR searchOwner.email LIKE :search OR searchPlan.name LIKE :search)'
          : `(${resource.search.map((field) => `item.${field} LIKE :search`).join(' OR ')})`,
        { search },
      );
    }
    if (dto.ownerId) {
      if (name === 'products') {
        query
          .innerJoin(Store, 'parent', 'parent.id = item.storeId')
          .andWhere('parent.ownerId = :ownerId', { ownerId: dto.ownerId });
      } else if (name === 'media') {
        query
          .leftJoin(Showcase, 'parentPost', 'parentPost.id = item.showcaseId')
          .leftJoin(
            Product,
            'parentProduct',
            'parentProduct.id = item.productId',
          )
          .leftJoin(
            Store,
            'parentStore',
            'parentStore.id = COALESCE(item.storeId, parentProduct.storeId)',
          )
          .andWhere(
            'COALESCE(parentPost.ownerId, parentStore.ownerId) = :ownerId',
            { ownerId: dto.ownerId },
          );
      } else if (resource.owner)
        query.andWhere(`item.${resource.owner} = :ownerId`, {
          ownerId: dto.ownerId,
        });
      else throw new BadRequestException('Owner filter is not supported');
    }
    if (dto.parentId) {
      if (!resource.parent)
        throw new BadRequestException('Parent filter is not supported');
      query.andWhere(`item.${resource.parent} = :parentId`, {
        parentId: dto.parentId,
      });
    }
    if (dto.status) {
      if (!resource.status)
        throw new BadRequestException('Status filter is not supported');
      query.andWhere(`item.${resource.status} = :status`, {
        status: dto.status,
      });
    }
    if (dto.archive !== 'all' && resource.archive)
      query.andWhere(
        `item.${resource.archive} IS ${dto.archive === 'archived' ? 'NOT ' : ''}NULL`,
      );
    const limit = Math.min(Math.max(dto.limit, 1), 100);
    const offset = Math.min(Math.max(dto.offset, 0), 100000);
    const [items, total] = await query
      .orderBy(
        `item.${resource.date ?? 'createdAt'}`,
        dto.sort === 'oldest' ? 'ASC' : 'DESC',
      )
      .addOrderBy(`item.${resource.key ?? 'id'}`, 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    return {
      items: await this.summaries(
        name,
        name === 'users' ? items.map((item) => this.withUserRole(item)) : items,
      ),
      total,
      limit,
      offset,
    };
  }

  async detail(name: string, id: string, actor: AdminActor) {
    await this.access.check(actor);
    const resource = this.resource(name);
    const item = await this.access.database
      .getRepository(resource.target)
      .createQueryBuilder('item')
      .select(resource.fields.map((field) => `item.${field}`))
      .where(`item.${resource.key ?? 'id'} = :id`, { id })
      .getOne();
    if (!item) throw new NotFoundException('Record not found');
    if (name === 'carts') {
      item.items = await this.access.database.getRepository(CartItem).find({
        where: { cartId: id },
        select: [
          'id',
          'productId',
          'quantity',
          'unitPriceCents',
          'productName',
          'productSlug',
          'notes',
        ],
        take: 100,
      });
    }
    if (name === 'media') {
      item.variants = await this.access.database
        .getRepository(MediaVariant)
        .find({
          where: { assetId: id },
          select: [
            'id',
            'label',
            'storageKey',
            'mimeType',
            'width',
            'height',
            'sizeBytes',
          ],
          take: 30,
        });
    }
    if (name === 'posts') {
      const media = await this.access.database.manager.find(MediaAsset, {
        where: { showcaseId: id },
        relations: ['variants'],
        take: 30,
        order: { position: 'ASC' },
      });
      item.media = media.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        status: asset.status,
        key:
          asset.variants.find(
            (v) =>
              v.mimeType ===
              (asset.kind === 'video' ? 'video/mp4' : 'image/webp'),
          )?.storageKey ?? null,
      }));
    }
    return (
      await this.summaries(name, [
        name === 'users' ? this.withUserRole(item) : item,
      ])
    )[0];
  }

  private async summaries(name: string, items: ObjectLiteral[]) {
    if (
      !items.length ||
      !['stores', 'products', 'posts', 'subscriptions'].includes(name)
    )
      return items;
    const manager = this.access.database.manager;
    const storeIds = [
      ...new Set(items.map((item) => item.storeId).filter(Boolean)),
    ] as string[];
    const stores = storeIds.length
      ? await manager.find(Store, {
          where: { id: In(storeIds) },
          select: ['id', 'name', 'slug', 'ownerId'],
        })
      : [];
    const storeMap = new Map(stores.map((store) => [store.id, store]));
    const ownerIds = [
      ...new Set(
        items
          .map(
            (item) =>
              item.ownerId ||
              item.userId ||
              storeMap.get(item.storeId)?.ownerId,
          )
          .filter(Boolean),
      ),
    ] as string[];
    const users = ownerIds.length
      ? await manager.find(User, {
          where: { id: In(ownerIds) },
          select: ['id', 'displayName', 'email'],
        })
      : [];
    const ownerMap = new Map(users.map((user) => [user.id, user]));
    const planIds = [
      ...new Set(items.map((item) => item.planId).filter(Boolean)),
    ] as string[];
    const plans = planIds.length
      ? await manager.find(SubscriptionPlan, {
          where: { id: In(planIds) },
          select: ['id', 'name'],
        })
      : [];
    const planMap = new Map(plans.map((plan) => [plan.id, plan]));
    return items.map((item) => ({
      ...item,
      store: storeMap.get(item.storeId),
      owner: ownerMap.get(
        item.ownerId || item.userId || storeMap.get(item.storeId)?.ownerId,
      ),
      plan: planMap.get(item.planId),
    }));
  }

  async overview(actor: AdminActor) {
    await this.access.check(actor);
    const manager = this.access.database.manager;
    const [users, stores, products, posts, media, errors] = await Promise.all([
      manager.count(User),
      manager.count(Store),
      manager.count(Product),
      manager.count(Showcase),
      manager.count(MediaAsset),
      manager
        .getRepository(SystemErrorRecord)
        .createQueryBuilder('error')
        .where("error.state != 'resolved'")
        .getCount(),
    ]);
    return { users, stores, products, posts, media, errors };
  }
}
