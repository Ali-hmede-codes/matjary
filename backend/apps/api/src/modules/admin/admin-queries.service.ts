import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, type EntityTarget, type ObjectLiteral } from 'typeorm';
import {
  AdminAuditLog,
  AdminScope,
  AdminStoreAssignment,
  BoostCampaign,
  BoostCampaignStatus,
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

// The only records a store-scoped administrator can read.
const SCOPED_RESOURCES = new Set(['stores', 'products', 'posts']);

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
    fields: fields(
      'id email displayName phone role adminScope suspendedAt createdAt updatedAt',
    ),
    // Support can find an owner by the number recorded on assignment.
    search: ['email', 'displayName', 'phone'],
    archive: 'suspendedAt',
  },
  stores: {
    target: Store,
    fields: fields(
      'id ownerId name slug status trashedAt description brandColor storeType businessCategory socialMediaLinks logoKey bannerKey enableCart enableWhatsAppCheckout designSettings latitude longitude address city country postalCode locationName phone website openingHours hasVerificationBadge verificationBadgeExpiresAt adminArchivedAt createdAt updatedAt',
    ),
    search: ['name', 'slug'],
    owner: 'ownerId',
    archive: 'adminArchivedAt',
    status: 'status',
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
      adminScope:
        item.adminScope === AdminScope.STORES
          ? AdminScope.STORES
          : AdminScope.ALL,
    };
  }

  private resource(name: string): Resource {
    if (!Object.hasOwn(ADMIN_RESOURCES, name))
      throw new NotFoundException('Administrative resource not found');
    return ADMIN_RESOURCES[name]!;
  }

  async list(name: string, dto: AdminListDto, actor: AdminActor) {
    const resource = this.resource(name);
    const { scope } = await this.access.panel(actor);
    if (!scope.all && !SCOPED_RESOURCES.has(name))
      throw new ForbiddenException('Platform administrator access required');
    const limit = Math.min(Math.max(dto.limit, 1), 100);
    const offset = Math.min(Math.max(dto.offset, 0), 100000);
    // A scoped administrator with no shops left reads nothing instead of all.
    if (!scope.all && !scope.storeIds.length)
      return { items: [], total: 0, limit, offset };
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
    if (!scope.all) {
      // Stores are filtered by their own id; their content by the owning shop.
      const column = name === 'stores' ? 'id' : 'storeId';
      query.andWhere(`item.${column} IN (:...adminStoreIds)`, {
        adminStoreIds: scope.storeIds,
      });
    }
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
    const resource = this.resource(name);
    const { scope } = await this.access.panel(actor);
    if (!scope.all && !SCOPED_RESOURCES.has(name))
      throw new ForbiddenException('Platform administrator access required');
    const item = await this.access.database
      .getRepository(resource.target)
      .createQueryBuilder('item')
      .select(resource.fields.map((field) => `item.${field}`))
      .where(`item.${resource.key ?? 'id'} = :id`, { id })
      .getOne();
    if (!item) throw new NotFoundException('Record not found');
    if (!scope.all) {
      const storeId = name === 'stores' ? item.id : item.storeId;
      this.access.assertStoreInScope(scope, storeId as string | null);
    }
    if (name === 'users') {
      // The admin workspace shows and edits a store-scoped administrator's shop
      // list from the same record, so it travels with the detail response.
      const assignments = await this.access.database.manager.find(
        AdminStoreAssignment,
        { where: { userId: id }, select: { storeId: true } },
      );
      const storeIds = assignments.map((assignment) => assignment.storeId);
      const assignedStores = storeIds.length
        ? await this.access.database.manager.find(Store, {
            where: { id: In(storeIds) },
            select: { id: true, name: true, slug: true },
            order: { name: 'ASC' },
          })
        : [];
      item.adminStoreIds = storeIds;
      item.adminStores = assignedStores;
    }
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
      ![
        'stores',
        'products',
        'posts',
        'subscriptions',
        'campaigns',
        'wallets',
        'transactions',
      ].includes(name)
    )
      return items;
    const manager = this.access.database.manager;
    const showcaseIds = [
      ...new Set(items.map((item) => item.targetShowcaseId).filter(Boolean)),
    ] as string[];
    const showcaseTargets = showcaseIds.length
      ? await manager.find(Showcase, {
          where: { id: In(showcaseIds) },
          select: ['id', 'title', 'slug', 'storeId'],
        })
      : [];
    const showcaseMap = new Map(
      showcaseTargets.map((showcase) => [showcase.id, showcase]),
    );
    const storeIds = [
      ...new Set(
        items
          .flatMap((item) => [
            item.storeId,
            item.targetStoreId,
            showcaseMap.get(item.targetShowcaseId)?.storeId,
          ])
          .filter(Boolean),
      ),
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
          select: ['id', 'displayName', 'email', 'phone'],
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
    return items.map((item) => {
      const targetShowcase = showcaseMap.get(item.targetShowcaseId);
      const showcaseStoreId = targetShowcase?.storeId ?? undefined;
      return {
        ...item,
        store: storeMap.get(item.storeId),
        owner: ownerMap.get(
          item.ownerId || item.userId || storeMap.get(item.storeId)?.ownerId,
        ),
        plan: planMap.get(item.planId),
        targetName:
          item.targetType === 'store'
            ? storeMap.get(item.targetStoreId)?.name
            : targetShowcase?.title,
        targetSlug:
          item.targetType === 'store'
            ? storeMap.get(item.targetStoreId)?.slug
            : targetShowcase?.slug,
        targetStoreSlug:
          item.targetType === 'store'
            ? storeMap.get(item.targetStoreId)?.slug
            : showcaseStoreId
              ? storeMap.get(showcaseStoreId)?.slug
              : undefined,
      };
    });
  }

  async overview(actor: AdminActor) {
    const { scope } = await this.access.panel(actor);
    const manager = this.access.database.manager;
    if (!scope.all) {
      // A store-scoped administrator sees only their shops and their content;
      // platform-wide counters stay hidden because they are not theirs to see.
      if (!scope.storeIds.length)
        return {
          users: 0,
          stores: 0,
          products: 0,
          posts: 0,
          media: 0,
          errors: 0,
          wallets: 0,
          activeCampaigns: 0,
        };
      const [stores, products, posts, media] = await Promise.all([
        manager.count(Store, { where: { id: In(scope.storeIds) } }),
        manager.count(Product, { where: { storeId: In(scope.storeIds) } }),
        manager.count(Showcase, { where: { storeId: In(scope.storeIds) } }),
        manager.count(MediaAsset, { where: { storeId: In(scope.storeIds) } }),
      ]);
      return {
        users: 0,
        stores,
        products,
        posts,
        media,
        errors: 0,
        wallets: 0,
        activeCampaigns: 0,
      };
    }
    const [
      users,
      stores,
      products,
      posts,
      media,
      errors,
      wallets,
      activeCampaigns,
    ] = await Promise.all([
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
      manager.count(BoostCoin),
      manager.count(BoostCampaign, {
        where: { status: BoostCampaignStatus.ACTIVE },
      }),
    ]);
    return {
      users,
      stores,
      products,
      posts,
      media,
      errors,
      wallets,
      activeCampaigns,
    };
  }
}
