import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
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
  purgeStoreRecords,
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
  AdminErrorStateDto,
  AdminUserUpdateDto,
  AdminUserRoleDto,
} from './admin.dto';
import { SeoService } from '../seo/seo.service';
import { deleteStoredObjects } from '../media-cleanup';

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly access: AdminAccessService,
    private readonly storage: StorageService,
    private readonly seo: SeoService,
    private readonly queue: QueueService,
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
      await manager.query(
        'UPDATE `users` SET `role` = ?, session_version = session_version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ?',
        [dto.role, id],
      );
      await appendAdminAudit(manager, actor, 'users', id, 'role.update', [
        'role',
        'sessionVersion',
      ]);
      return { id, role: dto.role };
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
    return this.access.transaction(actor, async (manager) => {
      const target = {
        stores: Store,
        products: Product,
        posts: Showcase,
        media: MediaAsset,
      }[resource];
      const item = await manager
        .getRepository(target)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('Content not found');
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
    });
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
