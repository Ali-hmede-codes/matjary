import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import {
  Store,
  StoreVerificationRequest,
  User,
  VerificationRequestStatus,
  appendAdminAudit,
  effectiveLimits,
  effectiveSubscription,
  nextVerificationExpiry,
  ownerWhere,
  requireAdmin,
  verificationBadgeInfo,
  verificationPricing,
  VERIFICATION_GRACE_DAYS,
  VERIFICATION_PERIOD_DAYS,
  type AdminActor,
} from '@app/database';
import type { AppEnvironment } from '@app/config';
import { normalizeLebanesePhone } from './verification-phone';
import type {
  AdminVerificationListDto,
  AdminVerificationStoresDto,
  SubmitVerificationDto,
} from './dto/verification.dto';

const DAY_MS = 86_400_000;
const PHONE_INVALID_CODE = 'VERIFICATION_PHONE_INVALID';
const NOT_AVAILABLE_CODE = 'VERIFICATION_NOT_AVAILABLE';

@Injectable()
export class VerificationService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Verification storage is temporarily unavailable',
    );
  }

  // ============================================
  // OWNER
  // ============================================

  /**
   * Everything the shop's Verification tab renders: the current badge state,
   * what the plan includes, the monthly add-on price, and the latest request.
   */
  async status(storeId: string, userId: string) {
    try {
      const manager = this.database.manager;
      const store = await manager.findOneBy(Store, {
        id: storeId,
        ...ownerWhere('store'),
      });
      if (!store) throw new NotFoundException('Store not found');
      this.assertOwner(store, userId);
      const [limits, subscription, activeBadges, pending, latest] =
        await Promise.all([
          effectiveLimits(manager, store.ownerId),
          effectiveSubscription(manager, store.ownerId),
          this.activeBadgeCount(manager, store.ownerId),
          this.latestRequest(
            manager,
            storeId,
            VerificationRequestStatus.PENDING,
          ),
          this.latestRequest(manager, storeId),
        ]);
      const pricing = verificationPricing(limits, {
        hasBadge: store.hasVerificationBadge,
        activeBadges,
      });
      return {
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          logoKey: store.logoKey,
        },
        badge: this.badgeView(store),
        plan: {
          name: subscription?.plan?.name ?? null,
          slug: subscription?.plan?.slug ?? null,
          maxBadges:
            limits.maxVerificationBadges === undefined
              ? 0
              : limits.maxVerificationBadges,
          activeBadges,
        },
        eligibility: {
          available: pricing.available,
          included: pricing.included,
          priceCents: String(pricing.priceCents),
          currency: 'USD',
          reason: pricing.available
            ? null
            : 'Your plan does not include verification and has no monthly price set.',
        },
        pendingRequest: pending ? this.requestView(pending) : null,
        latestRequest: latest ? this.requestView(latest) : null,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Create or refresh the pending application for one shop. A store row lock
   * serializes submissions, so a double-click cannot create two requests.
   */
  async submit(storeId: string, userId: string, dto: SubmitVerificationDto) {
    const phone = normalizeLebanesePhone(dto.phone);
    if (!phone)
      throw new BadRequestException({
        code: PHONE_INVALID_CODE,
        message: 'Enter a valid Lebanese phone number',
      });
    try {
      return await this.database.transaction(async (manager) => {
        const store = await manager.findOne(Store, {
          where: { id: storeId, ...ownerWhere('store') },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        this.assertOwner(store, userId);
        const [limits, activeBadges] = await Promise.all([
          effectiveLimits(manager, store.ownerId),
          this.activeBadgeCount(manager, store.ownerId),
        ]);
        const pricing = verificationPricing(limits, {
          hasBadge: store.hasVerificationBadge,
          activeBadges,
        });
        if (!pricing.available)
          throw new ForbiddenException({
            code: NOT_AVAILABLE_CODE,
            message:
              'Verification is not available on this plan. Contact an administrator.',
          });
        const pending = await this.latestRequest(
          manager,
          storeId,
          VerificationRequestStatus.PENDING,
          true,
        );
        const request =
          pending ??
          manager.create(StoreVerificationRequest, {
            storeId,
            ownerId: store.ownerId,
          });
        request.applicantName = dto.applicantName;
        request.phone = phone;
        request.note = dto.note?.trim() || null;
        request.includedInPlan = pricing.included;
        request.priceCents = String(pricing.priceCents);
        request.status = VerificationRequestStatus.PENDING;
        const saved = await manager.save(request);
        return this.requestView(saved);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async withdraw(storeId: string, userId: string) {
    try {
      await this.database.transaction(async (manager) => {
        const store = await manager.findOne(Store, {
          where: { id: storeId, ...ownerWhere('store') },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        this.assertOwner(store, userId);
        const pending = await this.latestRequest(
          manager,
          storeId,
          VerificationRequestStatus.PENDING,
          true,
        );
        if (!pending)
          throw new NotFoundException('No pending verification request');
        pending.status = VerificationRequestStatus.WITHDRAWN;
        await manager.save(pending);
      });
      return { withdrawn: true };
    } catch (error) {
      this.sanitize(error);
    }
  }

  // ============================================
  // ADMIN
  // ============================================

  async adminListRequests(actor: AdminActor, query: AdminVerificationListDto) {
    try {
      const manager = this.database.manager;
      await this.requireAdmin(manager, actor);
      const qb = manager
        .getRepository(StoreVerificationRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.store', 'store')
        .leftJoinAndSelect('request.owner', 'owner');
      if (query.status)
        qb.where('request.status = :status', { status: query.status });
      const [rows, total] = await qb
        .orderBy('request.createdAt', 'DESC')
        .take(query.limit)
        .skip(query.offset)
        .getManyAndCount();
      return {
        items: rows.map((request) => this.adminRequestView(request)),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async adminListStores(actor: AdminActor, query: AdminVerificationStoresDto) {
    try {
      const manager = this.database.manager;
      await this.requireAdmin(manager, actor);
      const now = new Date();
      const graceBorder = new Date(
        now.getTime() - VERIFICATION_GRACE_DAYS * DAY_MS,
      );
      const qb = manager
        .getRepository(Store)
        .createQueryBuilder('store')
        .leftJoinAndSelect('store.owner', 'owner')
        .where('store.hasVerificationBadge = true');
      if (query.state === 'active')
        qb.andWhere(
          '(store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :now)',
          { now },
        );
      if (query.state === 'grace')
        qb.andWhere(
          'store.verificationBadgeExpiresAt <= :now AND store.verificationBadgeExpiresAt > :graceBorder',
          { now, graceBorder },
        );
      if (query.state === 'expired')
        qb.andWhere('store.verificationBadgeExpiresAt <= :graceBorder', {
          graceBorder,
        });
      // The first ordering is a raw SQL expression, so paginate with limit():
      // take() runs TypeORM's distinct-id query, which parses every ordering as
      // alias.property and throws on expressions containing a dot. The owner
      // join is many-to-one, so limit() returns the same rows.
      const [rows, total] = await qb
        .addOrderBy(
          'CASE WHEN store.verificationBadgeExpiresAt IS NULL THEN 1 ELSE 0 END',
          'ASC',
        )
        .addOrderBy('store.verificationBadgeExpiresAt', 'ASC')
        .addOrderBy('store.name', 'ASC')
        .limit(query.limit)
        .offset(query.offset)
        .getManyAndCount();
      return {
        items: rows.map((store) => ({
          id: store.id,
          name: store.name,
          slug: store.slug,
          logoKey: store.logoKey,
          owner: store.owner
            ? {
                displayName: store.owner.displayName,
                email: store.owner.email,
              }
            : null,
          ...this.badgeView(store),
        })),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Admin approval starts (or extends) the paid month and closes the request.
   * The store row lock also guards against two admins approving at once.
   */
  async adminApprove(actor: AdminActor, requestId: string, reason: string) {
    const audited = this.actorWithReason(actor, reason);
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, audited);
        // Read first, then lock the store before the request: extension takes
        // the same store-first order, so the two actions cannot deadlock.
        const found = await manager.findOne(StoreVerificationRequest, {
          where: { id: requestId },
        });
        if (!found)
          throw new NotFoundException('Verification request not found');
        const store = await manager.findOne(Store, {
          where: { id: found.storeId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        const request = await manager.findOne(StoreVerificationRequest, {
          where: { id: requestId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!request)
          throw new NotFoundException('Verification request not found');
        if (request.status !== VerificationRequestStatus.PENDING)
          throw new ConflictException('This request is no longer pending');
        const now = new Date();
        const expiresAt = nextVerificationExpiry(
          store.verificationBadgeExpiresAt,
          now,
        );
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = audited.id;
        store.verificationBadgeExpiresAt = expiresAt;
        request.status = VerificationRequestStatus.APPROVED;
        request.reviewedBy = audited.id;
        request.reviewedAt = now;
        request.reviewNote = audited.reason ?? null;
        request.periodStartsAt = new Date(
          expiresAt.getTime() - VERIFICATION_PERIOD_DAYS * DAY_MS,
        );
        request.periodEndsAt = expiresAt;
        await manager.save([store, request]);
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          store.id,
          'verification.approve',
          ['hasVerificationBadge', 'verificationBadgeExpiresAt'],
        );
        return { success: true, expiresAt, requestId };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async adminReject(actor: AdminActor, requestId: string, reason: string) {
    const audited = this.actorWithReason(actor, reason);
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, audited);
        const request = await manager.findOne(StoreVerificationRequest, {
          where: { id: requestId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!request)
          throw new NotFoundException('Verification request not found');
        if (request.status !== VerificationRequestStatus.PENDING)
          throw new ConflictException('This request is no longer pending');
        request.status = VerificationRequestStatus.REJECTED;
        request.reviewedBy = audited.id;
        request.reviewedAt = new Date();
        request.reviewNote = audited.reason ?? null;
        await manager.save(request);
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          request.storeId,
          'verification.reject',
          ['status', 'reviewNote'],
        );
        return { success: true, requestId };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * The admin's one-click "+1 month". Pending renewals for the same shop are
   * approved by the same action, so the queue never keeps a stale row.
   */
  async adminExtend(actor: AdminActor, storeId: string, reason: string) {
    const audited = this.actorWithReason(actor, reason);
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, audited);
        const store = await manager.findOne(Store, {
          where: { id: storeId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        if (!store.hasVerificationBadge)
          throw new BadRequestException({
            code: 'VERIFICATION_NOT_GRANTED',
            message: 'This store has no verification badge to extend',
          });
        const now = new Date();
        const expiresAt = nextVerificationExpiry(
          store.verificationBadgeExpiresAt,
          now,
        );
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = audited.id;
        store.verificationBadgeExpiresAt = expiresAt;
        await manager.save(store);
        await this.settlePendingRequests(
          manager,
          storeId,
          audited,
          now,
          expiresAt,
        );
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          storeId,
          'verification.extend',
          ['verificationBadgeExpiresAt'],
        );
        return { success: true, storeId, expiresAt };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async adminRevoke(actor: AdminActor, storeId: string, reason: string) {
    const audited = this.actorWithReason(actor, reason);
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, audited);
        const store = await manager.findOne(Store, {
          where: { id: storeId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        store.hasVerificationBadge = false;
        store.verificationBadgeGrantedAt = null;
        store.verificationBadgeGrantedBy = null;
        store.verificationBadgeExpiresAt = null;
        await manager.save(store);
        await this.rejectPendingRequests(manager, storeId, audited);
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          storeId,
          'verification.revoke',
          ['hasVerificationBadge', 'verificationBadgeExpiresAt'],
        );
        return { success: true, storeId };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  private assertOwner(store: Store, userId: string): void {
    if (store.ownerId !== userId)
      throw new ForbiddenException(
        'Only the shop owner can manage verification',
      );
  }

  private async requireAdmin(
    manager: EntityManager,
    actor: AdminActor,
  ): Promise<User> {
    return requireAdmin(
      manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
  }

  private actorWithReason(actor: AdminActor, reason: string): AdminActor {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 500)
      throw new BadRequestException(
        'A reason between 3 and 500 characters is required',
      );
    return { ...actor, reason: trimmed };
  }

  private async latestRequest(
    manager: EntityManager,
    storeId: string,
    status?: VerificationRequestStatus,
    lock = false,
  ): Promise<StoreVerificationRequest | null> {
    return manager.findOne(StoreVerificationRequest, {
      where: { storeId, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC' },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  /**
   * Count the owner's badges that still occupy a plan slot: the paid month and
   * its grace window. Badges past the grace window no longer count.
   */
  private activeBadgeCount(
    manager: EntityManager,
    ownerId: string,
    now = new Date(),
  ): Promise<number> {
    const graceBorder = new Date(
      now.getTime() - VERIFICATION_GRACE_DAYS * DAY_MS,
    );
    return manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .where('store.ownerId = :ownerId', { ownerId })
      .andWhere('store.hasVerificationBadge = true')
      .andWhere(
        '(store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :graceBorder)',
        { graceBorder },
      )
      .getCount();
  }

  private badgeView(store: Store) {
    const badge = verificationBadgeInfo(store);
    return {
      state: badge.state,
      visible: badge.visible,
      grantedAt: store.verificationBadgeGrantedAt,
      expiresAt: badge.expiresAt,
      graceEndsAt: badge.graceEndsAt,
      daysRemaining: badge.daysRemaining,
    };
  }

  private requestView(request: StoreVerificationRequest) {
    return {
      id: request.id,
      status: request.status,
      applicantName: request.applicantName,
      phone: request.phone,
      note: request.note,
      includedInPlan: request.includedInPlan,
      priceCents: request.priceCents,
      periodStartsAt: request.periodStartsAt,
      periodEndsAt: request.periodEndsAt,
      reviewNote: request.reviewNote,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private adminRequestView(request: StoreVerificationRequest) {
    return {
      ...this.requestView(request),
      store: request.store
        ? {
            id: request.store.id,
            name: request.store.name,
            slug: request.store.slug,
            logoKey: request.store.logoKey,
            ...this.badgeView(request.store),
          }
        : null,
      owner: request.owner
        ? {
            displayName: request.owner.displayName,
            email: request.owner.email,
          }
        : null,
    };
  }

  private async settlePendingRequests(
    manager: EntityManager,
    storeId: string,
    actor: AdminActor,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    const pending = await manager.find(StoreVerificationRequest, {
      where: { storeId, status: VerificationRequestStatus.PENDING },
      lock: { mode: 'pessimistic_write' },
    });
    for (const request of pending) {
      request.status = VerificationRequestStatus.APPROVED;
      request.reviewedBy = actor.id;
      request.reviewedAt = now;
      request.reviewNote = actor.reason ?? null;
      request.periodStartsAt = new Date(
        expiresAt.getTime() - VERIFICATION_PERIOD_DAYS * DAY_MS,
      );
      request.periodEndsAt = expiresAt;
    }
    if (pending.length) await manager.save(pending);
  }

  private async rejectPendingRequests(
    manager: EntityManager,
    storeId: string,
    actor: AdminActor,
  ): Promise<void> {
    const pending = await manager.find(StoreVerificationRequest, {
      where: { storeId, status: VerificationRequestStatus.PENDING },
      lock: { mode: 'pessimistic_write' },
    });
    const now = new Date();
    for (const request of pending) {
      request.status = VerificationRequestStatus.REJECTED;
      request.reviewedBy = actor.id;
      request.reviewedAt = now;
      request.reviewNote = actor.reason ?? 'Verification revoked';
    }
    if (pending.length) await manager.save(pending);
  }
}
