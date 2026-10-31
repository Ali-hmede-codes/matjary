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
  VerificationSettings,
  appendAdminAudit,
  effectiveLimits,
  effectiveSubscription,
  includedBadgeExpiry,
  nextVerificationExpiry,
  ownerWhere,
  requireAdmin,
  verificationAddOnPriceCents,
  verificationBadgeInfo,
  verificationBadgeVisible,
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
  UpdateVerificationSettingsDto,
} from './dto/verification.dto';

const DAY_MS = 86_400_000;
const PHONE_INVALID_CODE = 'VERIFICATION_PHONE_INVALID';
const NOT_AVAILABLE_CODE = 'VERIFICATION_NOT_AVAILABLE';
const PLAN_INACTIVE_CODE = 'VERIFICATION_PLAN_INACTIVE';
const PLAN_SLOT_LOST_CODE = 'VERIFICATION_PLAN_SLOT_LOST';
const UNLIMITED_CODE = 'VERIFICATION_UNLIMITED';

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
   * what the plan includes, the monthly add-on price, the platform's payment
   * number, and the latest request.
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
      const [
        limits,
        subscription,
        includedBadges,
        includedShops,
        platform,
        pending,
        latest,
      ] = await Promise.all([
        effectiveLimits(manager, store.ownerId),
        effectiveSubscription(manager, store.ownerId),
        this.includedBadgeCount(manager, store.ownerId),
        this.includedBadgeShops(manager, store.ownerId),
        this.platformSettings(manager),
        this.latestRequest(manager, storeId, VerificationRequestStatus.PENDING),
        this.latestRequest(manager, storeId),
      ]);
      const pricing = verificationPricing(limits, {
        includedBadge: this.usesBundledSlot(store),
        activeIncludedBadges: includedBadges,
        // A lapsed subscription fails every quota closed, including this one.
        fallbackPriceCents: subscription ? platform.priceCents : 0,
      });
      // The tab always shows what one badge month is worth, even when the plan
      // covers it and nothing is charged.
      const addOnPriceCents = subscription
        ? verificationAddOnPriceCents(limits, platform.priceCents)
        : 0;
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
          activeBadges: includedBadges,
          // Bundled badges end here; the tab explains the link to the plan.
          endsAt: subscription?.expiresAt ?? null,
          // Which shops already hold the owner's bundled slots. The tab names
          // them so an owner adding a second shop understands the price.
          includedShops: includedShops.map((shop) => ({
            id: shop.id,
            name: shop.name,
            slug: shop.slug,
          })),
        },
        eligibility: {
          available: pricing.available,
          included: pricing.included,
          // What this shop pays per month; zero while a bundled slot covers it.
          priceCents: String(pricing.priceCents),
          // The monthly value of one badge outside a bundled slot.
          addOnPriceCents: String(addOnPriceCents),
          currency: 'USD',
          reason: pricing.available
            ? null
            : subscription
              ? 'The platform has not set a monthly badge price yet. Contact an administrator.'
              : 'Choose an active plan before adding verification to this shop.',
        },
        // Owners call or message this number to pay for an add-on badge month.
        payment: { contactPhone: platform.contactPhone },
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
        // A lifetime grant is not a monthly badge, so there is nothing to
        // renew; only an administrator can change it.
        if (
          store.hasVerificationBadge &&
          store.verificationBadgeExpiresAt === null &&
          !store.verificationIncludedInPlan
        )
          throw new ConflictException({
            code: UNLIMITED_CODE,
            message: 'This shop already has unlimited verification.',
          });
        const [limits, includedBadges, subscription, platform] =
          await Promise.all([
            effectiveLimits(manager, store.ownerId),
            this.includedBadgeCount(manager, store.ownerId),
            effectiveSubscription(manager, store.ownerId),
            this.platformSettings(manager),
          ]);
        const pricing = verificationPricing(limits, {
          includedBadge: this.usesBundledSlot(store),
          activeIncludedBadges: includedBadges,
          fallbackPriceCents: subscription ? platform.priceCents : 0,
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

  /**
   * Platform badge economics. The price is the fallback for plans without a
   * bundled slot or their own add-on price; the phone is where owners pay.
   */
  async adminGetSettings(actor: AdminActor) {
    try {
      const manager = this.database.manager;
      await this.requireAdmin(manager, actor);
      const settings = await this.platformSettings(manager);
      return this.settingsView(settings);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async adminUpdateSettings(
    actor: AdminActor,
    dto: UpdateVerificationSettingsDto,
  ) {
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, actor);
        let settings = await manager.findOne(VerificationSettings, {
          where: { id: 1 },
          lock: { mode: 'pessimistic_write' },
        });
        if (!settings)
          settings = manager.create(VerificationSettings, { id: 1 });
        const changed: string[] = [];
        if (
          dto.badgePriceCents !== undefined &&
          dto.badgePriceCents !== settings.badgePriceCents
        ) {
          settings.badgePriceCents = dto.badgePriceCents;
          changed.push('badgePriceCents');
        }
        if (
          dto.contactPhone !== undefined &&
          dto.contactPhone !== settings.contactPhone
        ) {
          settings.contactPhone = dto.contactPhone;
          changed.push('contactPhone');
        }
        if (changed.length) {
          await manager.save(settings);
          await appendAdminAudit(
            manager,
            actor,
            'verification-settings',
            '1',
            'update',
            changed,
          );
        }
        return this.settingsView({
          priceCents: Math.max(0, settings.badgePriceCents),
          contactPhone: settings.contactPhone,
        });
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

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
        // A bundled badge is paid by the subscription, so it ends when the plan
        // does. A monthly add-on keeps its own rolling period.
        let expiresAt: Date | null;
        let periodStartsAt = now;
        if (request.includedInPlan) {
          // The plan economics can change between application and approval: a
          // bundled application must still have a live subscription and a slot.
          const [limits, includedBadges, subscription] = await Promise.all([
            effectiveLimits(manager, store.ownerId),
            this.includedBadgeCount(manager, store.ownerId),
            effectiveSubscription(manager, store.ownerId, now),
          ]);
          if (!subscription)
            throw new BadRequestException({
              code: PLAN_INACTIVE_CODE,
              message:
                'The owner has no active subscription. Assign a plan or reject this request.',
            });
          const pricing = verificationPricing(limits, {
            includedBadge: this.usesBundledSlot(store),
            activeIncludedBadges: includedBadges,
          });
          if (!pricing.included)
            throw new BadRequestException({
              code: PLAN_SLOT_LOST_CODE,
              message:
                'The plan no longer includes a badge slot. Reject this request so the owner can apply at the monthly price.',
            });
          expiresAt = includedBadgeExpiry(
            {
              subscriptionExpiresAt: subscription.expiresAt ?? null,
              currentExpiry: store.verificationBadgeExpiresAt,
              currentIncluded: store.verificationIncludedInPlan,
            },
            now,
          );
          store.verificationIncludedInPlan = true;
        } else {
          expiresAt = nextVerificationExpiry(
            store.verificationBadgeExpiresAt,
            now,
          );
          store.verificationIncludedInPlan = false;
          periodStartsAt = new Date(
            expiresAt.getTime() - VERIFICATION_PERIOD_DAYS * DAY_MS,
          );
        }
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = audited.id;
        store.verificationBadgeExpiresAt = expiresAt;
        request.status = VerificationRequestStatus.APPROVED;
        request.reviewedBy = audited.id;
        request.reviewedAt = now;
        request.reviewNote = audited.reason ?? null;
        request.periodStartsAt = periodStartsAt;
        request.periodEndsAt = expiresAt;
        await manager.save([store, request]);
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          store.id,
          'verification.approve',
          [
            'hasVerificationBadge',
            'verificationBadgeExpiresAt',
            'verificationIncludedInPlan',
          ],
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
        // A lifetime grant has no month to extend; the admin revokes it first
        // if the shop should go back to a monthly badge.
        if (
          !store.verificationIncludedInPlan &&
          store.verificationBadgeExpiresAt === null
        )
          throw new BadRequestException({
            code: UNLIMITED_CODE,
            message:
              'This badge has no end date. Revoke it first to make it a monthly badge.',
          });
        // Bundled badges follow the subscription, so "+1 month" re-reads the
        // plan end instead of stacking free months. Add-ons stack as before.
        let expiresAt: Date | null;
        let periodStartsAt = now;
        if (store.verificationIncludedInPlan) {
          const subscription = await effectiveSubscription(
            manager,
            store.ownerId,
            now,
          );
          if (!subscription)
            throw new BadRequestException({
              code: PLAN_INACTIVE_CODE,
              message:
                'This badge is bundled with the plan and the subscription is no longer active. Assign a plan first.',
            });
          expiresAt = includedBadgeExpiry(
            {
              subscriptionExpiresAt: subscription.expiresAt ?? null,
              currentExpiry: store.verificationBadgeExpiresAt,
              currentIncluded: true,
            },
            now,
          );
        } else {
          expiresAt = nextVerificationExpiry(
            store.verificationBadgeExpiresAt,
            now,
          );
          periodStartsAt = new Date(
            expiresAt.getTime() - VERIFICATION_PERIOD_DAYS * DAY_MS,
          );
        }
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
          periodStartsAt,
        );
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          storeId,
          'verification.extend',
          ['verificationBadgeExpiresAt', 'verificationIncludedInPlan'],
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
        store.verificationIncludedInPlan = false;
        await manager.save(store);
        await this.rejectPendingRequests(manager, storeId, audited);
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          storeId,
          'verification.revoke',
          [
            'hasVerificationBadge',
            'verificationBadgeExpiresAt',
            'verificationIncludedInPlan',
          ],
        );
        return { success: true, storeId };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * The administrator's "special shop" action: verification with no end date.
   * It is deliberately not a plan-bundled slot and carries no monthly price, so
   * subscription changes never shorten it; only an explicit revoke removes it.
   */
  async adminGrantUnlimited(
    actor: AdminActor,
    storeId: string,
    reason: string,
  ) {
    const audited = this.actorWithReason(actor, reason);
    try {
      return await this.database.transaction(async (manager) => {
        await this.requireAdmin(manager, audited);
        const store = await manager.findOne(Store, {
          where: { id: storeId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        const now = new Date();
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = audited.id;
        store.verificationBadgeExpiresAt = null;
        store.verificationIncludedInPlan = false;
        await manager.save(store);
        // The shop is verified for good, so any waiting application is settled
        // with an open-ended period instead of a paid month.
        await this.settlePendingRequests(
          manager,
          storeId,
          audited,
          now,
          null,
          now,
        );
        await appendAdminAudit(
          manager,
          audited,
          'stores',
          storeId,
          'verification.unlimited',
          [
            'hasVerificationBadge',
            'verificationBadgeExpiresAt',
            'verificationIncludedInPlan',
          ],
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

  /**
   * A bundled badge holds its plan slot only while it is still visible. Once
   * the paid month and its grace window end, another shop may take the slot,
   * so the lapsed shop has to compete for a free one (or pay the add-on).
   */
  private usesBundledSlot(store: Store): boolean {
    return store.verificationIncludedInPlan && verificationBadgeVisible(store);
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

  /**
   * The platform-wide price and payment number. A missing row means the paid
   * add-on is off: owners still see the plan economics, with price zero.
   */
  private async platformSettings(
    manager: EntityManager,
  ): Promise<{ priceCents: number; contactPhone: string | null }> {
    const settings = await manager
      .getRepository(VerificationSettings)
      .findOneBy({ id: 1 });
    return {
      priceCents: Math.max(0, settings?.badgePriceCents ?? 0),
      contactPhone: settings?.contactPhone ?? null,
    };
  }

  private settingsView(input: {
    priceCents: number;
    contactPhone: string | null;
  }) {
    return {
      badgePriceCents: String(input.priceCents),
      currency: 'USD',
      contactPhone: input.contactPhone,
    };
  }

  /**
   * The owner's shops that still occupy a bundled slot: the paid period and
   * its grace window. The verification tab names them so an owner knows which
   * shop already used the included badge before paying for another one.
   */
  private includedBadgeShops(
    manager: EntityManager,
    ownerId: string,
    now = new Date(),
  ): Promise<Store[]> {
    const graceBorder = new Date(
      now.getTime() - VERIFICATION_GRACE_DAYS * DAY_MS,
    );
    return manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .select(['store.id', 'store.name', 'store.slug'])
      .where('store.ownerId = :ownerId', { ownerId })
      .andWhere('store.hasVerificationBadge = true')
      .andWhere('store.verificationIncludedInPlan = true')
      .andWhere(
        '(store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :graceBorder)',
        { graceBorder },
      )
      .orderBy('store.name', 'ASC')
      .getMany();
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
   * Count the owner's bundled badges that still occupy a plan slot: the paid
   * period and its grace window. Monthly add-ons never occupy a slot, and
   * badges past the grace window no longer count.
   */
  private includedBadgeCount(
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
      .andWhere('store.verificationIncludedInPlan = true')
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
      // True while this badge uses one of the plan's bundled slots.
      included: store.verificationIncludedInPlan,
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
    expiresAt: Date | null,
    periodStartsAt: Date,
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
      request.periodStartsAt = periodStartsAt;
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
