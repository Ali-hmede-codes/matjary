import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import {
  AdminScope,
  AdminStoreAssignment,
  User,
  UserRole,
  Store,
  Product,
  Showcase,
  MediaAsset,
  MediaVariant,
  MediaStatus,
  ShowcaseStatus,
  StoreStatus,
  Cart,
  CartStatus,
  SystemErrorRecord,
  MediaProcessingOutbox,
  appendAdminAudit,
  isAdminEmail,
  isAdminUser,
  effectiveLimits,
  assertQuota,
  assertContentAvailable,
  isBusinessCategory,
  purgeStoreRecords,
  STORE_SLUG_TAKEN_CODE,
  nextVerificationExpiry,
  verificationBadgeVisible,
  StoreVerificationRequest,
  VerificationRequestStatus,
  VERIFICATION_PERIOD_DAYS,
  type AdminActor,
} from '@app/database';
import { StorageService } from '@app/storage';
import { QueueService } from '@app/queue';
import { AdminAccessService } from './admin-access.service';
import {
  AdminCreateStoreDto,
  AdminErrorStateDto,
  AdminUpdateStoreDto,
  AdminUserScopeDto,
  AdminUserUpdateDto,
  AdminUserRoleDto,
} from './admin.dto';
import { SeoService } from '../seo/seo.service';
import { StoresService } from '../stores/stores.service';
import { deleteStoredObjects } from '../media-cleanup';

// A store-scoped administrator never assumes another scope by omission, so the
// assignment list is bounded and validated before it is written.
const MAX_ASSIGNED_STORES = 200;

@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly access: AdminAccessService,
    private readonly storage: StorageService,
    private readonly seo: SeoService,
    private readonly queue: QueueService,
    private readonly stores: StoresService,
  ) {}

  async updateUser(id: string, dto: AdminUserUpdateDto, actor: AdminActor) {
    return this.access.transaction(actor, async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      user.displayName = dto.displayName;
      await manager.save(user);
      await appendAdminAudit(manager, actor, 'users', id, 'profile.update', [
        'displayName',
      ]);
      return { id };
    });
  }

  // The shops a store-scoped administrator may oversee, validated in the same
  // transaction that writes them. A trashed shop cannot be assigned because its
  // admin records are already unreachable.
  private async resolveAdminScope(
    manager: EntityManager,
    scope: AdminScope | undefined,
    storeIds: string[] | undefined,
  ): Promise<{ scope: AdminScope; storeIds: string[] }> {
    if ((scope ?? AdminScope.ALL) === AdminScope.ALL)
      return { scope: AdminScope.ALL, storeIds: [] };
    const ids = [...new Set(storeIds ?? [])].filter(Boolean);
    if (!ids.length)
      throw new BadRequestException(
        'Choose at least one store for a store-scoped administrator',
      );
    if (ids.length > MAX_ASSIGNED_STORES)
      throw new BadRequestException(
        `A store-scoped administrator can oversee at most ${MAX_ASSIGNED_STORES} stores`,
      );
    const stores = await manager.find(Store, {
      where: { id: In(ids) },
      select: { id: true, status: true },
    });
    if (stores.length !== ids.length)
      throw new BadRequestException('One or more stores were not found');
    if (stores.some((store) => store.status === StoreStatus.TRASHED))
      throw new BadRequestException(
        'A store in Trash cannot be assigned to an administrator',
      );
    return { scope: AdminScope.STORES, storeIds: ids };
  }

  private async replaceAdminStores(
    manager: EntityManager,
    userId: string,
    storeIds: string[],
  ): Promise<void> {
    await manager.delete(AdminStoreAssignment, { userId });
    if (!storeIds.length) return;
    await manager.insert(
      AdminStoreAssignment,
      storeIds.map((storeId) => ({ userId, storeId })),
    );
  }

  async updateUserRole(id: string, dto: AdminUserRoleDto, input: AdminActor) {
    const actor = this.access.reason(input, dto.reason);
    return this.access.transaction(actor, async (manager) => {
      // Serialize against role revocation before granting anyone else access.
      const administrator = await manager.findOne(User, {
        where: { id: actor.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !administrator ||
        administrator.suspendedAt ||
        !isAdminUser(administrator, this.access.allowlist)
      )
        throw new ForbiddenException('Admin access required');
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      if (isAdminEmail(user.email, this.access.allowlist))
        throw new ConflictException(
          'Configured administrator roles cannot be changed',
        );
      if (id === actor.id)
        throw new ConflictException('You cannot change your own role');
      if (dto.role === UserRole.ADMIN && user.suspendedAt)
        throw new ConflictException(
          'Restore the account before granting admin access',
        );
      if (user.role === dto.role) return { id, role: user.role };
      if (user.sessionVersion >= 4294967295)
        throw new ConflictException('Session version limit reached');
      // Granting admin access chooses the reach at the same time: the whole
      // platform (the historic behavior) or the shops picked in the request.
      const scope =
        dto.role === UserRole.ADMIN
          ? await this.resolveAdminScope(manager, dto.scope, dto.storeIds)
          : { scope: AdminScope.ALL, storeIds: [] };
      await manager.query(
        'UPDATE `users` SET `role` = ?, `admin_scope` = ?, session_version = session_version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ?',
        [dto.role, scope.scope, id],
      );
      await this.replaceAdminStores(manager, id, scope.storeIds);
      await appendAdminAudit(manager, actor, 'users', id, 'role.update', [
        'role',
        'adminScope',
        'sessionVersion',
      ]);
      return { id, role: dto.role, scope: scope.scope };
    });
  }

  async updateUserScope(id: string, dto: AdminUserScopeDto, input: AdminActor) {
    const actor = this.access.reason(input, dto.reason);
    return this.access.transaction(actor, async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      if (isAdminEmail(user.email, this.access.allowlist))
        throw new ConflictException(
          'Configured administrator access cannot be changed',
        );
      if (id === actor.id)
        throw new ConflictException('You cannot change your own access');
      if (user.role !== UserRole.ADMIN)
        throw new ConflictException(
          'Grant administrator access before assigning stores',
        );
      const scope = await this.resolveAdminScope(
        manager,
        dto.scope,
        dto.storeIds,
      );
      await manager.query(
        'UPDATE `users` SET `admin_scope` = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?',
        [scope.scope, id],
      );
      await this.replaceAdminStores(manager, id, scope.storeIds);
      await appendAdminAudit(manager, actor, 'users', id, 'scope.update', [
        'adminScope',
      ]);
      return { id, ...scope };
    });
  }

  async accountAction(
    id: string,
    action: 'suspend' | 'restore' | 'revoke-sessions',
    reason: string,
    input: AdminActor,
  ) {
    const actor = this.access.reason(input, reason);
    return this.access.transaction(actor, async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      if (
        action === 'suspend' &&
        isAdminEmail(user.email, this.access.allowlist)
      )
        throw new ConflictException(
          'Configured administrators cannot be suspended',
        );
      if (user.sessionVersion >= 4294967295)
        throw new ConflictException('Session version limit reached');
      if (action === 'suspend') user.suspendedAt = new Date();
      if (action === 'restore') user.suspendedAt = null;
      user.sessionVersion++;
      await manager.save(user);
      await appendAdminAudit(manager, actor, 'users', id, action, [
        'suspendedAt',
        'sessionVersion',
      ]);
      return { id, suspendedAt: user.suspendedAt };
    });
  }

  async archive(
    resource: 'stores' | 'products' | 'posts' | 'media',
    id: string,
    archived: boolean,
    reason: string,
    input: AdminActor,
  ) {
    const actor = this.access.reason(input, reason);
    // Hiding content is the one moderation action a store-scoped administrator
    // performs, and only inside the shops assigned to them.
    return this.access.transaction(
      actor,
      async (manager) => {
        const { scope } = await this.access.panel(actor, manager);
        // Load the locked row through its concrete repository, so the result is
        // a typed entity union rather than an untyped record.
        const lock = { mode: 'pessimistic_write' as const };
        const load = {
          stores: () =>
            manager.getRepository(Store).findOne({ where: { id }, lock }),
          products: () =>
            manager.getRepository(Product).findOne({ where: { id }, lock }),
          posts: () =>
            manager.getRepository(Showcase).findOne({ where: { id }, lock }),
          media: () =>
            manager.getRepository(MediaAsset).findOne({ where: { id }, lock }),
        };
        const item = await load[resource]();
        if (!item) throw new NotFoundException('Content not found');
        if (!scope.all) {
          if (resource === 'media')
            throw new ForbiddenException(
              'Platform administrator access required',
            );
          // A shop row owns the id itself; its content carries the shop id.
          const storeId = 'storeId' in item ? item.storeId : item.id;
          this.access.assertStoreInScope(scope, storeId);
        }
        item.adminArchivedAt = archived ? new Date() : null;
        // The moderation column is excluded from ORM saves, including stale owner
        // and worker entities. Only this audited, locked operation writes it.
        const table = {
          stores: 'stores',
          products: 'products',
          posts: 'showcases',
          media: 'media_assets',
        }[resource];
        await manager.query(
          `UPDATE \`${table}\` SET admin_archived_at = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
          [item.adminArchivedAt, id],
        );
        await appendAdminAudit(
          manager,
          actor,
          resource,
          id,
          archived ? 'archive' : 'restore',
          ['adminArchivedAt'],
        );
        return { id, adminArchivedAt: item.adminArchivedAt };
      },
      'any',
    );
  }

  // Only a platform administrator opens shops on someone else's behalf. Plan
  // quotas do not apply, so a website administrator can seed as many shops as
  // the platform needs; the acting administrator and the owner are audited.
  async createStore(dto: AdminCreateStoreDto, actor: AdminActor) {
    await this.access.check(actor);
    return this.stores.create(dto, dto.ownerId, {
      administrator: { actor, allowlist: this.access.allowlist },
    });
  }

  // Editing the public address is a platform-wide operation: a store-scoped
  // administrator hides content, but the shop's identity stays with the website
  // team. The unique index remains the final authority, so two administrators
  // renaming shops at once still cannot share an address.
  async updateStore(id: string, dto: AdminUpdateStoreDto, input: AdminActor) {
    const actor = this.access.reason(input, dto.reason);
    const saved = await this.access.transaction(actor, async (manager) => {
      const store = await manager.findOne(Store, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!store) throw new NotFoundException('Store not found');
      // A shop in Trash is waiting for restore or permanent deletion; editing its
      // public address there would only create links that cannot open.
      if (store.status === StoreStatus.TRASHED)
        throw new ConflictException('Restore the store before editing it');
      if (dto.slug !== undefined && dto.slug !== store.slug) {
        const taken = await manager.findOne(Store, {
          where: { slug: dto.slug },
        });
        if (taken && taken.id !== id)
          throw new ConflictException({
            code: STORE_SLUG_TAKEN_CODE,
            message: 'A store with this slug already exists',
          });
        store.slug = dto.slug;
      }
      if (dto.name !== undefined) store.name = dto.name;
      if (dto.description !== undefined) store.description = dto.description;
      if (dto.brandColor !== undefined) store.brandColor = dto.brandColor;
      if (dto.storeType !== undefined) store.storeType = dto.storeType;
      if (dto.businessCategory !== undefined) {
        if (!isBusinessCategory(dto.businessCategory))
          throw new BadRequestException('Choose a valid business category');
        store.businessCategory = dto.businessCategory;
      }
      await manager.save(store);
      await appendAdminAudit(manager, actor, 'stores', id, 'store.update', [
        'name',
        'slug',
        'description',
        'brandColor',
        'storeType',
        'businessCategory',
      ]);
      return store;
    });
    // Public metadata follows the shop, not the caller: a renamed or re-addressed
    // shop must refresh its tags and shared pages even though an administrator
    // performed the edit. The share-shell pass remains the last line of defence.
    try {
      await this.seo.autoGenerateOwnedSeo('store', saved.id, saved.ownerId);
      await this.seo.notifyIndexNowOnChange('store', saved);
    } catch (error) {
      this.logger.warn(
        'Failed to refresh store SEO after an administrative edit',
        error,
      );
    }
    return {
      id: saved.id,
      name: saved.name,
      slug: saved.slug,
      status: saved.status,
    };
  }

  async purgeStore(id: string, reason: string, input: AdminActor) {
    const actor = this.access.reason(input, reason);
    const keys = await this.access.transaction(actor, async (manager) => {
      const store = await manager.findOne(Store, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!store) throw new NotFoundException('Store not found');
      // Owners reach this state first; an administrator cannot bypass the
      // two-step Trash flow and erase an active shop in one request.
      if (store.status !== StoreStatus.TRASHED)
        throw new ConflictException(
          'Move the store to Trash before deleting it permanently',
        );
      const keys = await purgeStoreRecords(manager, id);
      await appendAdminAudit(manager, actor, 'stores', id, 'purge');
      return keys;
    });
    await deleteStoredObjects(this.storage, keys);
    return { id };
  }

  async previewMedia(id: string, actor: AdminActor, label?: string) {
    await this.access.check(actor);
    if (label && !/^[a-z0-9-]{1,40}$/.test(label))
      throw new BadRequestException('Invalid media label');
    const asset = await this.access.database.manager.findOneBy(MediaAsset, {
      id,
    });
    if (!asset) throw new NotFoundException('Media not found');
    if (label === 'original') {
      if (!asset.originalKey)
        throw new NotFoundException('Original is no longer retained');
      return {
        url: await this.storage.presignedGetUrl(asset.originalKey),
        mimeType: asset.mimeType,
      };
    }
    const variants = await this.access.database.manager.find(MediaVariant, {
      where: { assetId: id, ...(label ? { label } : {}) },
      take: 30,
      order: { width: 'DESC' },
    });
    const variant =
      variants.find(
        (item) =>
          item.mimeType ===
          (asset.kind === 'video' ? 'video/mp4' : 'image/webp'),
      ) ?? variants[0];
    if (!variant)
      throw new NotFoundException('No processed preview is available');
    return {
      url: await this.storage.presignedGetUrl(variant.storageKey),
      mimeType: variant.mimeType,
    };
  }

  async retryMedia(id: string, reason: string, input: AdminActor) {
    const actor = this.access.reason(input, reason);
    return this.access.transaction(actor, async (manager) => {
      const asset = await manager.findOne(MediaAsset, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!asset) throw new NotFoundException('Media not found');
      await assertContentAvailable(manager, 'media', id);
      if (
        asset.status !== MediaStatus.FAILED ||
        !asset.originalKey ||
        !asset.processingLimits
      )
        throw new ConflictException(
          'Only failed media with a retained original can be retried',
        );
      const original = await this.storage.statObject(asset.originalKey);
      if (
        original.size !== Number(asset.sizeBytes) ||
        original.size <= 0 ||
        original.size > asset.processingLimits.maxBytes
      )
        throw new ConflictException(
          'Original is unavailable or invalid; upload it again',
        );
      const job = await this.queue.getQueue().getJob(`media-${id}`);
      if (job) {
        const state = await job.getState();
        if (!['failed', 'completed'].includes(state))
          throw new ConflictException('A processing job is already scheduled');
        // Recovery uses a stable job ID. Remove only terminal jobs while holding
        // the asset lock so it cannot confuse an old failure with this retry.
        await job.remove();
      }
      asset.status = MediaStatus.PROCESSING;
      await manager.save(asset);
      await manager.insert(MediaProcessingOutbox, { assetId: id });
      await appendAdminAudit(manager, actor, 'media', id, 'retry', ['status']);
      return { id, status: asset.status };
    });
  }

  async badge(id: string, enabled: boolean, reason: string, input: AdminActor) {
    const actor = this.access.reason(input, reason);
    return this.access.transaction(actor, async (manager) => {
      const store = await manager.findOne(Store, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!store) throw new NotFoundException('Store not found');
      // Granting an already-visible badge is a no-op; the verification queue
      // owns month-by-month extensions.
      if (enabled && verificationBadgeVisible(store)) return { id, enabled };
      const now = new Date();
      const pending = await manager.find(StoreVerificationRequest, {
        where: { storeId: id, status: VerificationRequestStatus.PENDING },
      });
      if (enabled) {
        // Manual grants follow the same monthly rule as approvals: one month
        // from today, or from a still-running period. Pending applications for
        // the shop are closed so the queue never keeps a stale row.
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = actor.id;
        // A manual administrator grant is not a plan bundle: it keeps its own
        // month and never consumes one of the owner's bundled slots.
        store.verificationIncludedInPlan = false;
        store.verificationBadgeExpiresAt = nextVerificationExpiry(
          store.verificationBadgeExpiresAt,
          now,
        );
        for (const request of pending) {
          request.status = VerificationRequestStatus.APPROVED;
          request.reviewedBy = actor.id;
          request.reviewedAt = now;
          request.reviewNote = actor.reason ?? null;
          request.periodStartsAt = new Date(
            store.verificationBadgeExpiresAt.getTime() -
              VERIFICATION_PERIOD_DAYS * 86_400_000,
          );
          request.periodEndsAt = store.verificationBadgeExpiresAt;
        }
      } else {
        store.hasVerificationBadge = false;
        store.verificationBadgeGrantedAt = null;
        store.verificationBadgeGrantedBy = null;
        store.verificationBadgeExpiresAt = null;
        store.verificationIncludedInPlan = false;
        for (const request of pending) {
          request.status = VerificationRequestStatus.REJECTED;
          request.reviewedBy = actor.id;
          request.reviewedAt = now;
          request.reviewNote = actor.reason ?? 'Verification revoked';
        }
      }
      await manager.save(store);
      if (pending.length) await manager.save(pending);
      await appendAdminAudit(
        manager,
        actor,
        'stores',
        id,
        enabled ? 'badge.grant' : 'badge.revoke',
        [
          'hasVerificationBadge',
          'verificationBadgeExpiresAt',
          'verificationIncludedInPlan',
        ],
      );
      return { id, enabled };
    });
  }

  async expireCart(id: string, reason: string, input: AdminActor) {
    const actor = this.access.reason(input, reason);
    return this.access.transaction(actor, async (manager) => {
      const cart = await manager.findOne(Cart, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cart) throw new NotFoundException('Cart not found');
      if (cart.status !== CartStatus.ACTIVE)
        throw new ConflictException('Only active carts can be expired');
      cart.status = CartStatus.EXPIRED;
      cart.expiresAt = new Date();
      await manager.save(cart);
      await appendAdminAudit(manager, actor, 'carts', id, 'expire', [
        'status',
        'expiresAt',
      ]);
      return { id };
    });
  }

  async errorState(id: string, dto: AdminErrorStateDto, input: AdminActor) {
    const actor = this.access.reason(input, dto.reason);
    return this.access.transaction(actor, async (manager) => {
      const record = await manager.findOne(SystemErrorRecord, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) throw new NotFoundException('Error issue not found');
      record.state = dto.state;
      await manager.save(record);
      await appendAdminAudit(manager, actor, 'errors', id, 'state.update', [
        'state',
      ]);
      return { id, state: record.state };
    });
  }
}
