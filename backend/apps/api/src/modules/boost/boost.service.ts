import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { RedisService } from '@app/queue';
import {
  Repository,
  DataSource,
  In,
  Between,
  type EntityManager,
} from 'typeorm';
import { createHash, randomUUID as uuidv4 } from 'node:crypto';

export function coinAmount(value: string | number, signed = false): bigint {
  const text = String(value);
  if (!(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(text))
    throw new BadRequestException('Coins must be integers');
  const amount = BigInt(text);
  if (
    amount > BigInt(Number.MAX_SAFE_INTEGER) ||
    amount < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new BadRequestException('Coin amount is out of range');
  return amount;
}
import {
  BoostCoin,
  BoostTransaction,
  BoostCampaign,
  BoostCampaignPerformance,
  BoostSetting,
  BoostTransactionType,
  BoostTransactionReferenceType,
  BoostCampaignStatus,
  BoostTargetType,
  BoostBidStrategy,
  BoostTargeting,
  BoostCreative,
  User,
  Showcase,
  Store,
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
  publicWhere,
  publicVisibilitySql,
  assertContentAvailable,
  assertSubscriptionActive,
  requireAdmin,
  appendAdminAudit,
  adminContext,
  actorContext,
  type AdminActor,
} from '@app/database';

// Campaign delivery is billed in whole coins so balances never drift into
// fractions. CPM bids are per 1,000 impressions and are charged once per
// completed block; CPC and AUTO campaigns pay per click.
export function billableDeliveryCoins(
  strategy: BoostBidStrategy,
  bidAmountCoins: string | null,
  fallbackCpcCoins: number,
  metric: 'impressions' | 'clicks',
  dailyImpressions: bigint,
): bigint {
  if (metric === 'clicks') {
    if (strategy === BoostBidStrategy.CPC)
      return bidAmountCoins ? coinAmount(bidAmountCoins) : 0n;
    if (strategy === BoostBidStrategy.AUTO)
      return BigInt(Math.max(0, Math.trunc(fallbackCpcCoins)));
    return 0n;
  }
  if (strategy !== BoostBidStrategy.CPM || !bidAmountCoins) return 0n;
  return dailyImpressions > 0n && dailyImpressions % 1000n === 0n
    ? coinAmount(bidAmountCoins)
    : 0n;
}

// The floor applies to every write path: a bid below it would deliver free
// advertising that never exhausts the campaign budget.
export function assertBidMeetsMinimum(
  strategy: BoostBidStrategy,
  bidAmountCoins: string | null | undefined,
  minimums: { cpc: number; cpm: number },
): void {
  if (strategy === BoostBidStrategy.AUTO) {
    if (bidAmountCoins) coinAmount(bidAmountCoins);
    return;
  }
  const minimum =
    strategy === BoostBidStrategy.CPC ? minimums.cpc : minimums.cpm;
  if (!bidAmountCoins || coinAmount(bidAmountCoins) < BigInt(minimum))
    throw new BadRequestException(
      `Minimum ${strategy.toUpperCase()} bid is ${minimum} coins`,
    );
}

// Client-reported delivery is deduplicated per viewer so a retry or a scripted
// loop cannot credit the same impression or click window repeatedly.
export const IMPRESSION_DEDUPE_SECONDS = 600;
export const CLICK_DEDUPE_SECONDS = 60;

@Injectable()
export class BoostService {
  constructor(
    @InjectRepository(BoostCoin)
    private readonly boostCoinRepo: Repository<BoostCoin>,
    @InjectRepository(BoostTransaction)
    private readonly boostTransactionRepo: Repository<BoostTransaction>,
    @InjectRepository(BoostCampaign)
    private readonly boostCampaignRepo: Repository<BoostCampaign>,
    @InjectRepository(BoostCampaignPerformance)
    private readonly boostPerformanceRepo: Repository<BoostCampaignPerformance>,
    @InjectRepository(BoostSetting)
    private readonly boostSettingRepo: Repository<BoostSetting>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Showcase)
    private readonly showcaseRepo: Repository<Showcase>,
    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly redis: RedisService,
  ) {}

  private async auditContext(
    manager: EntityManager,
    resource: string,
    id: string,
    action: string,
  ): Promise<void> {
    const actor = adminContext.getStore();
    if (!actor) return;
    await requireAdmin(
      manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
    await appendAdminAudit(manager, actor, resource, id, action);
  }

  async asAdministrator<T>(
    actor: AdminActor,
    action: () => Promise<T>,
  ): Promise<T> {
    await requireAdmin(
      this.dataSource.manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
    return adminContext.run(actor, action);
  }

  private async visibleCampaign(
    manager: EntityManager,
    campaign: BoostCampaign,
  ): Promise<void> {
    const kind =
      campaign.targetType === BoostTargetType.STORE ? 'store' : 'post';
    await assertContentAvailable(manager, kind, campaign.targetId, 'public');
    if (kind === 'post') {
      const post = await manager.findOneBy(Showcase, { id: campaign.targetId });
      if (post?.status !== 'published')
        throw new NotFoundException('Campaign target is unavailable');
    }
  }

  // ============================================
  // Boost Settings (Admin)
  // ============================================

  private settingsCache: Map<string, unknown> = new Map();
  private settingsCacheTime = 0;
  private readonly SETTINGS_TTL_MS = 60_000; // 1 minute

  async getSettings(forceRefresh = false): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.settingsCache.size > 0 &&
      now - this.settingsCacheTime < this.SETTINGS_TTL_MS
    ) {
      return Object.fromEntries(this.settingsCache);
    }

    const settings = await this.boostSettingRepo.find();
    this.settingsCache.clear();
    for (const s of settings) {
      this.settingsCache.set(s.key, s.value);
    }
    this.settingsCacheTime = now;
    return Object.fromEntries(this.settingsCache);
  }

  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const settings = await this.getSettings();
    const value = settings[key];
    if (value === undefined) return defaultValue;
    return value as T;
  }

  async getCoinPriceCents(): Promise<number> {
    return this.getSetting<number>('coin_price_cents', 100);
  }

  async getMinPurchaseCoins(): Promise<number> {
    return this.getSetting<number>('min_purchase_coins', 100);
  }

  async getMaxPurchaseCoins(): Promise<number> {
    return this.getSetting<number>('max_purchase_coins', 100000);
  }

  async getDefaultDailyBudgetCoins(): Promise<number> {
    return this.getSetting<number>('default_daily_budget_coins', 1000);
  }

  async getMinCampaignBudgetCoins(): Promise<number> {
    return this.getSetting<number>('min_campaign_budget_coins', 100);
  }

  async getMaxCampaignDurationDays(): Promise<number> {
    return this.getSetting<number>('max_campaign_duration_days', 90);
  }

  async isCampaignReviewRequired(): Promise<boolean> {
    return this.getSetting<boolean>('campaign_review_required', true);
  }

  async getAutoApproveThresholdCoins(): Promise<number> {
    return this.getSetting<number>('auto_approve_threshold_coins', 1000);
  }

  async getCpcMinBidCoins(): Promise<number> {
    return this.getSetting<number>('cpc_min_bid_coins', 1);
  }

  async getCpmMinBidCoins(): Promise<number> {
    return this.getSetting<number>('cpm_min_bid_coins', 10);
  }

  async getPlatformFeePercent(): Promise<number> {
    return this.getSetting<number>('platform_fee_percent', 0);
  }

  async updateSettings(
    dto: Record<string, unknown>,
    adminUserId: string,
  ): Promise<void> {
    const allowed = [
      'coinPriceCents',
      'minPurchaseCoins',
      'maxPurchaseCoins',
      'defaultDailyBudgetCoins',
      'minCampaignBudgetCoins',
      'maxCampaignDurationDays',
      'campaignReviewRequired',
      'autoApproveThresholdCoins',
      'cpcMinBidCoins',
      'cpmMinBidCoins',
      'platformFeePercent',
    ];
    const actor = actorContext(adminUserId);
    await this.dataSource.transaction(async (manager) => {
      await requireAdmin(
        manager,
        actor,
        this.config.get('ADMIN_EMAILS', { infer: true }),
      );
      for (const [key, value] of Object.entries(dto)) {
        if (!allowed.includes(key))
          throw new BadRequestException('Unknown boost setting');
        if (key === 'campaignReviewRequired') {
          if (typeof value !== 'boolean')
            throw new BadRequestException('Invalid boost setting');
        } else if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value <
            (['autoApproveThresholdCoins', 'platformFeePercent'].includes(key)
              ? 0
              : 1) ||
          (key === 'platformFeePercent' && value > 100) ||
          (key === 'maxCampaignDurationDays' && value > 365)
        )
          throw new BadRequestException('Invalid boost setting');
        const storedKey = key.replace(
          /[A-Z]/g,
          (letter) => `_${letter.toLowerCase()}`,
        );
        await manager.getRepository(BoostSetting).upsert(
          {
            key: storedKey,
            value: value as number | boolean,
            updatedBy: adminUserId,
          },
          ['key'],
        );
      }
      await appendAdminAudit(
        manager,
        actor,
        'boost-settings',
        'global',
        'update',
        Object.keys(dto),
      );
    });
    this.settingsCache.clear(); // Invalidate cache
  }

  async getPublicSettings(): Promise<{
    coinPriceCents: number;
    minPurchaseCoins: number;
    maxPurchaseCoins: number;
    minCampaignBudgetCoins: number;
    maxCampaignDurationDays: number;
    cpcMinBidCoins: number;
    cpmMinBidCoins: number;
  }> {
    return {
      coinPriceCents: await this.getCoinPriceCents(),
      minPurchaseCoins: await this.getMinPurchaseCoins(),
      maxPurchaseCoins: await this.getMaxPurchaseCoins(),
      minCampaignBudgetCoins: await this.getMinCampaignBudgetCoins(),
      maxCampaignDurationDays: await this.getMaxCampaignDurationDays(),
      cpcMinBidCoins: await this.getCpcMinBidCoins(),
      cpmMinBidCoins: await this.getCpmMinBidCoins(),
    };
  }

  // ============================================
  // Boost Coin Balance
  // ============================================

  private async lockedBalance(
    manager: EntityManager,
    userId: string,
  ): Promise<BoostCoin> {
    // Stable lock order: owner -> wallet -> campaign -> daily totals.
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user || user.suspendedAt)
      throw new NotFoundException('Active user not found');
    let balance = await manager.findOne(BoostCoin, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!balance)
      balance = await manager.save(
        BoostCoin,
        manager.create(BoostCoin, { userId, balance: '0' }),
      );
    return balance;
  }

  private async mutateCampaign<T>(
    id: string,
    ownerId: string | undefined,
    action: (
      campaign: BoostCampaign,
      wallet: BoostCoin,
      manager: EntityManager,
    ) => Promise<T>,
  ): Promise<T> {
    const current = await this.getCampaign(id, ownerId);
    return this.dataSource.transaction(async (manager) => {
      const wallet = await this.lockedBalance(manager, current.userId);
      const campaign = await manager.findOneOrFail(BoostCampaign, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (ownerId && campaign.userId !== ownerId)
        throw new ForbiddenException('Not your campaign');
      const result = await action(campaign, wallet, manager);
      await this.auditContext(
        manager,
        'campaigns',
        campaign.id,
        'campaign.mutate',
      );
      return result;
    });
  }

  async getOrCreateBalance(userId: string): Promise<BoostCoin> {
    return this.dataSource.transaction((manager) =>
      this.lockedBalance(manager, userId),
    );
  }

  async getBalance(userId: string): Promise<{
    balance: string;
    balanceNumber: number;
    pendingSpend: string;
    availableBalance: string;
    availableBalanceNumber: number;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.lockedBalance(manager, userId);
      const pendingSpend = await this.getPendingSpend(userId, manager);
      const available = coinAmount(balance.balance) - pendingSpend;
      return {
        balance: balance.balance,
        balanceNumber: Number(balance.balance),
        pendingSpend: String(pendingSpend),
        availableBalance: String(available),
        availableBalanceNumber: Number(available),
      };
    });
  }

  private async getPendingSpend(
    userId: string,
    manager: EntityManager,
  ): Promise<bigint> {
    const campaigns = await manager.find(BoostCampaign, {
      where: {
        userId,
        status: In([
          BoostCampaignStatus.DRAFT,
          BoostCampaignStatus.PENDING_REVIEW,
          BoostCampaignStatus.ACTIVE,
          BoostCampaignStatus.PAUSED,
        ]),
      },
    });
    const now = Date.now();
    return campaigns.reduce(
      (sum, campaign) =>
        // A campaign whose schedule has passed cannot serve again, so its
        // remaining budget is released without waiting for a status write.
        campaign.endAt && campaign.endAt.getTime() <= now
          ? sum
          : sum +
            coinAmount(campaign.budgetCoins) -
            coinAmount(campaign.spentCoins),
      0n,
    );
  }

  // ============================================
  // Transactions
  // ============================================

  private async createTransaction(
    userId: string,
    type: BoostTransactionType,
    amount: number, // signed integer
    referenceId: string | null,
    referenceType: BoostTransactionReferenceType | null,
    description: string | null,
    metadata: Record<string, unknown> | null,
    operationId: string,
    administrator?: AdminActor,
  ): Promise<BoostTransaction> {
    const delta = coinAmount(amount, true);
    if (!delta || !/^[a-zA-Z0-9_-]{1,100}$/.test(operationId))
      throw new BadRequestException(
        'A nonzero amount and operation ID are required',
      );
    return this.dataSource.transaction(async (manager) => {
      if (administrator)
        await requireAdmin(
          manager,
          administrator,
          this.config.get('ADMIN_EMAILS', { infer: true }),
        );
      const balance = await this.lockedBalance(manager, userId);
      const existing = await manager.findOneBy(BoostTransaction, {
        operationId,
      });
      if (existing) {
        if (
          existing.userId !== userId ||
          existing.type !== type ||
          existing.amount !== String(delta) ||
          existing.referenceId !== referenceId
        )
          throw new BadRequestException('Operation ID was already used');
        return existing;
      }
      const before = coinAmount(balance.balance);
      const after = before + delta;
      coinAmount(String(after));
      if (after < (await this.getPendingSpend(userId, manager)))
        throw new BadRequestException('Insufficient unreserved boost coins');
      const transaction = manager.create(BoostTransaction, {
        id: uuidv4(),
        operationId,
        userId,
        type,
        amount: String(delta),
        balanceBefore: String(before),
        balanceAfter: String(after),
        referenceId,
        referenceType,
        description,
        metadata,
      });
      balance.balance = String(after);
      await manager.save(balance);
      const saved = await manager.save(transaction);
      if (administrator)
        await appendAdminAudit(
          manager,
          administrator,
          'wallets',
          userId,
          'balance.adjust',
          ['balance'],
        );
      return saved;
    });
  }

  async addCoins(
    userId: string,
    amount: number,
    referenceId: string | null,
    referenceType: BoostTransactionReferenceType,
    description: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<BoostTransaction> {
    if (coinAmount(amount) <= 0n || !referenceId)
      throw new BadRequestException(
        'Positive amount and unique reference are required',
      );
    return this.createTransaction(
      userId,
      BoostTransactionType.PURCHASE,
      amount,
      referenceId,
      referenceType,
      description,
      metadata,
      `purchase-${referenceId}`,
    );
  }

  async getTransactions(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ transactions: BoostTransaction[]; total: number }> {
    const [transactions, total] = await this.boostTransactionRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { transactions, total };
  }

  // ============================================
  // Admin: User Balance Management
  // ============================================

  async adminAdjustBalance(
    adminUserId: string,
    targetUserId: string,
    amount: number, // positive = grant, negative = deduct
    description: string,
    operationId: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<{ transaction: BoostTransaction; newBalance: string }> {
    const actor = actorContext(adminUserId);
    if (
      typeof description !== 'string' ||
      description.trim().length < 3 ||
      description.length > 500
    )
      throw new BadRequestException(
        'A reason between 3 and 500 characters is required',
      );
    actor.reason = description.trim();
    await requireAdmin(
      this.dataSource.manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
    const targetUser = await this.userRepo.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) throw new NotFoundException('User not found');

    const type =
      amount > 0
        ? BoostTransactionType.ADMIN_GRANT
        : BoostTransactionType.ADMIN_DEDUCT;
    const absAmount = Math.abs(amount);

    const transaction = await this.createTransaction(
      targetUserId,
      type,
      amount, // signed
      null,
      BoostTransactionReferenceType.ADMIN,
      description,
      { ...metadata, adminUserId },
      operationId,
      actor,
    );

    return { transaction, newBalance: transaction.balanceAfter };
  }

  // ============================================
  // Boost Campaigns
  // ============================================

  async validateTarget(
    targetType: BoostTargetType,
    targetId: string,
    userId: string,
  ): Promise<{ name: string; slug: string; imageKey?: string }> {
    if (targetType === BoostTargetType.SHOWCASE) {
      const showcase = await this.showcaseRepo.findOne({
        where: { id: targetId, ...publicWhere('post') },
        relations: ['store'],
      });
      if (!showcase) throw new NotFoundException('Showcase not found');
      if (showcase.ownerId !== userId)
        throw new ForbiddenException('You can only boost your own showcases');
      if (showcase.status !== 'published' || !showcase.storeId)
        throw new BadRequestException(
          'Only posts published to a shop can be boosted',
        );
      return {
        name: showcase.title,
        slug: showcase.slug,
        imageKey: showcase.mediaAssets?.[0]?.originalKey ?? undefined,
      };
    } else {
      const store = await this.storeRepo.findOne({
        where: { id: targetId, ...publicWhere('store') },
      });
      if (!store) throw new NotFoundException('Store not found');
      if (store.ownerId !== userId)
        throw new ForbiddenException('You can only boost your own stores');
      return {
        name: store.name,
        slug: store.slug,
        imageKey: store.logoKey ?? undefined,
      };
    }
  }

  private async postPreviewKey(
    showcaseId: string,
  ): Promise<string | undefined> {
    const asset = await this.showcaseRepo.manager.findOne(MediaAsset, {
      where: {
        showcaseId,
        status: MediaStatus.READY,
        ...publicWhere('media'),
      },
      order: { position: 'ASC' },
    });
    if (!asset) return undefined;
    const variants = await this.showcaseRepo.manager.find(MediaVariant, {
      where: { assetId: asset.id },
      select: { label: true, storageKey: true },
    });
    // Videos produce a poster instead of image variants; a video original can
    // never render inside the sponsored image slot.
    const preview =
      variants.find((variant) => variant.label === 'webp-480') ??
      variants.find((variant) => variant.label.startsWith('poster-'));
    if (preview) return preview.storageKey;
    return asset.kind === MediaKind.IMAGE
      ? (asset.originalKey ?? undefined)
      : undefined;
  }

  async getCampaignTargetInfo(
    targetType: BoostTargetType,
    targetId: string,
  ): Promise<{ name: string; slug: string; imageKey?: string }> {
    if (targetType === BoostTargetType.SHOWCASE) {
      const showcase = await this.showcaseRepo.findOne({
        where: { id: targetId },
      });
      if (showcase) {
        return {
          name: showcase.title,
          slug: showcase.slug,
          imageKey: await this.postPreviewKey(showcase.id),
        };
      }
    } else {
      const store = await this.storeRepo.findOne({
        where: { id: targetId },
      });
      if (store) {
        return {
          name: store.name,
          slug: store.slug,
          imageKey: store.logoKey ?? undefined,
        };
      }
    }
    return { name: '', slug: '' };
  }

  private async assertBid(
    strategy: BoostBidStrategy,
    bidAmountCoins: string | null | undefined,
  ): Promise<void> {
    assertBidMeetsMinimum(strategy, bidAmountCoins, {
      cpc: await this.getCpcMinBidCoins(),
      cpm: await this.getCpmMinBidCoins(),
    });
  }

  async createCampaign(
    userId: string,
    dto: {
      name: string;
      targetType: BoostTargetType;
      targetId: string;
      budgetCoins: string;
      dailyBudgetCoins?: string;
      bidStrategy: BoostBidStrategy;
      bidAmountCoins?: string;
      targeting: BoostTargeting;
      creative?: BoostCreative;
      startAt?: Date;
      endAt?: Date;
    },
  ): Promise<BoostCampaign> {
    // Validate target ownership
    const targetInfo = await this.validateTarget(
      dto.targetType,
      dto.targetId,
      userId,
    );

    // Validate budget
    const budgetCoins = coinAmount(dto.budgetCoins);
    const minBudget = await this.getMinCampaignBudgetCoins();
    if (budgetCoins < BigInt(minBudget)) {
      throw new BadRequestException(
        `Minimum campaign budget is ${minBudget} coins`,
      );
    }

    // Validate dates
    const now = new Date();
    const startAt = dto.startAt || now;
    const maxDuration = await this.getMaxCampaignDurationDays();
    const maxEndAt = new Date(
      now.getTime() + maxDuration * 24 * 60 * 60 * 1000,
    );

    if (
      !Number.isFinite(startAt.getTime()) ||
      (dto.endAt &&
        (!Number.isFinite(dto.endAt.getTime()) ||
          dto.endAt <= startAt ||
          dto.endAt > maxEndAt))
    ) {
      throw new BadRequestException(
        `Campaign duration cannot exceed ${maxDuration} days`,
      );
    }

    // Validate bid amounts
    await this.assertBid(dto.bidStrategy, dto.bidAmountCoins);

    // Determine initial status
    const reviewRequired = await this.isCampaignReviewRequired();
    const autoApproveThreshold = await this.getAutoApproveThresholdCoins();
    let status = BoostCampaignStatus.DRAFT;

    if (reviewRequired && budgetCoins > BigInt(autoApproveThreshold)) {
      status = BoostCampaignStatus.PENDING_REVIEW;
    } else {
      status = BoostCampaignStatus.ACTIVE;
    }

    if (
      dto.dailyBudgetCoins &&
      (coinAmount(dto.dailyBudgetCoins) <= 0n ||
        coinAmount(dto.dailyBudgetCoins) > budgetCoins)
    )
      throw new BadRequestException('Invalid daily budget');
    return this.dataSource.transaction(async (manager) => {
      const wallet = await this.lockedBalance(manager, userId);
      // Starting a new promotion requires an active trial or paid plan.
      await assertSubscriptionActive(manager, userId);
      if (
        coinAmount(wallet.balance) -
          (await this.getPendingSpend(userId, manager)) <
        budgetCoins
      )
        throw new BadRequestException(
          'Insufficient boost coin balance for campaign budget',
        );
      const campaign = manager.create(BoostCampaign, {
        id: uuidv4(),
        userId,
        name: dto.name,
        targetType: dto.targetType,
        targetStoreId:
          dto.targetType === BoostTargetType.STORE ? dto.targetId : null,
        targetShowcaseId:
          dto.targetType === BoostTargetType.SHOWCASE ? dto.targetId : null,
        status,
        budgetCoins: dto.budgetCoins,
        spentCoins: '0',
        dailyBudgetCoins: dto.dailyBudgetCoins || null,
        bidStrategy: dto.bidStrategy,
        bidAmountCoins: dto.bidAmountCoins || null,
        targeting: dto.targeting,
        creative: dto.creative || null,
        startAt,
        endAt: dto.endAt || null,
      });

      const saved = await manager.save(campaign);
      await this.auditContext(manager, 'campaigns', saved.id, 'create');
      return saved;
    });
  }

  async getCampaign(
    campaignId: string,
    userId?: string,
  ): Promise<BoostCampaign> {
    const campaign = await this.boostCampaignRepo.findOne({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (userId && campaign.userId !== userId)
      throw new ForbiddenException('Not your campaign');
    return campaign;
  }

  async getCampaigns(
    userId: string,
    status?: BoostCampaignStatus,
    limit = 20,
    offset = 0,
  ): Promise<{ campaigns: BoostCampaign[]; total: number }> {
    const qb = this.boostCampaignRepo
      .createQueryBuilder('campaign')
      .where('campaign.userId = :userId', { userId });
    if (status) qb.andWhere('campaign.status = :status', { status });
    qb.orderBy('campaign.createdAt', 'DESC').take(limit).skip(offset);
    const [campaigns, total] = await qb.getManyAndCount();
    return { campaigns, total };
  }

  async updateCampaign(
    campaignId: string,
    userId: string,
    dto: Partial<{
      name: string;
      budgetCoins: string;
      dailyBudgetCoins: string;
      bidStrategy: BoostBidStrategy;
      bidAmountCoins: string;
      targeting: BoostTargeting;
      creative: BoostCreative;
      startAt: Date;
      endAt: Date;
    }>,
  ): Promise<BoostCampaign> {
    return this.mutateCampaign(
      campaignId,
      userId,
      async (campaign, wallet, manager) => {
        await assertSubscriptionActive(manager, userId);
        // Only allow updates for draft or pending_review campaigns
        if (
          ![
            BoostCampaignStatus.DRAFT,
            BoostCampaignStatus.PENDING_REVIEW,
          ].includes(campaign.status)
        ) {
          throw new BadRequestException(
            'Cannot update active or completed campaigns',
          );
        }

        // Validate budget increase
        if (dto.budgetCoins) {
          const newBudget = coinAmount(dto.budgetCoins);
          const oldBudget = coinAmount(campaign.budgetCoins);
          if (newBudget < oldBudget) {
            throw new BadRequestException('Cannot reduce campaign budget');
          }
          const additional = newBudget - oldBudget;
          if (
            coinAmount(wallet.balance) -
              (await this.getPendingSpend(userId, manager)) <
            additional
          ) {
            throw new BadRequestException(
              'Insufficient balance for budget increase',
            );
          }
        }

        // Validate dates
        if (dto.endAt) {
          const maxDuration = await this.getMaxCampaignDurationDays();
          const maxEndAt = new Date(
            Date.now() + maxDuration * 24 * 60 * 60 * 1000,
          );
          if (dto.endAt > maxEndAt) {
            throw new BadRequestException(
              `Campaign duration cannot exceed ${maxDuration} days`,
            );
          }
        }

        for (const key of [
          'name',
          'budgetCoins',
          'dailyBudgetCoins',
          'bidStrategy',
          'bidAmountCoins',
          'targeting',
          'creative',
          'startAt',
          'endAt',
        ] as const) {
          if (dto[key] !== undefined)
            Object.assign(campaign, { [key]: dto[key] });
        }
        if (
          campaign.dailyBudgetCoins &&
          (coinAmount(campaign.dailyBudgetCoins) <= 0n ||
            coinAmount(campaign.dailyBudgetCoins) >
              coinAmount(campaign.budgetCoins))
        )
          throw new BadRequestException('Invalid daily budget');
        await this.assertBid(campaign.bidStrategy, campaign.bidAmountCoins);
        if (
          campaign.endAt &&
          (!Number.isFinite(campaign.endAt.getTime()) ||
            campaign.endAt <= (campaign.startAt ?? new Date()))
        )
          throw new BadRequestException('Invalid campaign dates');
        return manager.save(campaign);
      },
    );
  }

  async pauseCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    return this.mutateCampaign(
      campaignId,
      userId,
      async (campaign, _wallet, manager) => {
        if (campaign.status === BoostCampaignStatus.PAUSED) return campaign;
        if (campaign.status !== BoostCampaignStatus.ACTIVE) {
          throw new BadRequestException('Only active campaigns can be paused');
        }
        campaign.status = BoostCampaignStatus.PAUSED;
        campaign.pausedAt = new Date();
        return manager.save(campaign);
      },
    );
  }

  async resumeCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    return this.mutateCampaign(
      campaignId,
      userId,
      async (campaign, _wallet, manager) => {
        if (campaign.status === BoostCampaignStatus.ACTIVE) return campaign;
        if (campaign.status !== BoostCampaignStatus.PAUSED) {
          throw new BadRequestException('Only paused campaigns can be resumed');
        }
        await this.visibleCampaign(manager, campaign);
        await assertSubscriptionActive(manager, userId);
        // Check if campaign has expired
        if (campaign.endAt && campaign.endAt < new Date()) {
          throw new BadRequestException('Campaign has expired');
        }
        // Check budget
        const spent = coinAmount(campaign.spentCoins);
        const budget = coinAmount(campaign.budgetCoins);
        if (spent >= budget) {
          throw new BadRequestException('Campaign budget exhausted');
        }
        campaign.status = BoostCampaignStatus.ACTIVE;
        campaign.pausedAt = null;
        return manager.save(campaign);
      },
    );
  }

  async cancelCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    return this.mutateCampaign(
      campaignId,
      userId,
      async (campaign, _wallet, manager) => {
        if (
          [
            BoostCampaignStatus.COMPLETED,
            BoostCampaignStatus.CANCELLED,
            BoostCampaignStatus.REJECTED,
          ].includes(campaign.status)
        )
          return campaign;
        campaign.status = BoostCampaignStatus.CANCELLED;
        campaign.completedAt = new Date();
        // The budget was reserved, never debited. Releasing it is not a credit.
        return manager.save(campaign);
      },
    );
  }

  // ============================================
  // Campaign Performance
  // ============================================

  async recordImpression(
    campaignId: string,
    date: Date = new Date(),
    viewerKey?: string,
  ): Promise<void> {
    if (
      !(await this.claimDelivery(
        'impression',
        campaignId,
        viewerKey,
        IMPRESSION_DEDUPE_SECONDS,
      ))
    )
      return;
    await this.incrementPerformance(campaignId, 'impressions', date);
  }

  async recordClick(
    campaignId: string,
    date: Date = new Date(),
    viewerKey?: string,
  ): Promise<void> {
    if (
      !(await this.claimDelivery(
        'click',
        campaignId,
        viewerKey,
        CLICK_DEDUPE_SECONDS,
      ))
    )
      return;
    await this.incrementPerformance(campaignId, 'clicks', date);
  }

  // Returns true when this viewer may still credit the delivery window. A
  // missing viewer key (internal callers) is always allowed.
  private async claimDelivery(
    kind: 'impression' | 'click',
    campaignId: string,
    viewerKey: string | undefined,
    seconds: number,
  ): Promise<boolean> {
    if (!viewerKey) return true;
    const key = `matjary:boost:${kind}:${createHash('sha256')
      .update(`${campaignId}|${viewerKey}`)
      .digest('hex')}`;
    try {
      return await this.redis.setIfNotExistsWithTtl(key, '1', seconds);
    } catch {
      // Delivery telemetry must not fail a page interaction when Redis is down.
      return true;
    }
  }

  private assertActive(campaign: BoostCampaign, date: Date): void {
    if (
      !Number.isFinite(date.getTime()) ||
      campaign.status !== BoostCampaignStatus.ACTIVE ||
      (campaign.startAt && campaign.startAt > date) ||
      (campaign.endAt && campaign.endAt <= date)
    )
      throw new BadRequestException('Campaign is not active');
  }

  private async incrementPerformance(
    campaignId: string,
    metric: 'clicks' | 'impressions',
    date: Date,
  ): Promise<void> {
    // Read the cached setting before locking the campaign and wallet.
    const fallbackCpcCoins = await this.getCpcMinBidCoins();
    await this.mutateCampaign(
      campaignId,
      undefined,
      async (campaign, wallet, manager) => {
        this.assertActive(campaign, date);
        await this.visibleCampaign(manager, campaign);
        const dateStr = date.toISOString().slice(0, 10);
        const daily =
          (await manager.findOneBy(BoostCampaignPerformance, {
            campaignId,
            date: dateStr,
          })) ??
          manager.create(BoostCampaignPerformance, {
            campaignId,
            date: dateStr,
            impressions: '0',
            clicks: '0',
            spendCoins: '0',
          });

        if (metric === 'impressions')
          daily.impressions = String(coinAmount(daily.impressions) + 1n);
        else daily.clicks = String(coinAmount(daily.clicks) + 1n);

        // Delivery charges are derived from the stored counters, so a retried
        // tracking request can never bill the same block twice.
        const charge = billableDeliveryCoins(
          campaign.bidStrategy,
          campaign.bidAmountCoins,
          fallbackCpcCoins,
          metric,
          coinAmount(daily.impressions),
        );
        const budget = coinAmount(campaign.budgetCoins);
        let spent = coinAmount(campaign.spentCoins);
        const today = coinAmount(daily.spendCoins);
        const balance = coinAmount(wallet.balance);
        const withinTotalBudget = spent + charge <= budget;
        const withinDailyBudget =
          !campaign.dailyBudgetCoins ||
          today + charge <= coinAmount(campaign.dailyBudgetCoins);
        const affordable =
          charge > 0n && withinTotalBudget && withinDailyBudget;

        if (affordable && balance >= charge) {
          wallet.balance = String(balance - charge);
          spent += charge;
          daily.spendCoins = String(today + charge);
          await manager.save(wallet);
          await manager.insert(BoostTransaction, {
            id: uuidv4(),
            operationId: `ad-${metric === 'clicks' ? 'click' : 'imp'}-${campaignId}-${dateStr}-${metric === 'clicks' ? daily.clicks : daily.impressions}`,
            userId: campaign.userId,
            type: BoostTransactionType.CAMPAIGN_SPEND,
            amount: String(-charge),
            balanceBefore: String(balance),
            balanceAfter: wallet.balance,
            referenceId: campaignId,
            referenceType: BoostTransactionReferenceType.CAMPAIGN,
            description:
              metric === 'clicks' ? 'Campaign click' : 'Campaign impressions',
            metadata: { date: dateStr, metric },
          });
          campaign.spentCoins = String(spent);
        }

        // A reserved wallet is how campaigns fail safely: when the reservation
        // can no longer cover delivery, stop serving instead of going negative.
        if (charge > 0n && balance < charge) {
          campaign.status = BoostCampaignStatus.PAUSED;
          campaign.pausedAt = new Date();
        }
        if (spent >= budget) {
          campaign.status = BoostCampaignStatus.COMPLETED;
          campaign.completedAt = new Date();
        }

        await manager.save(campaign);
        await manager.save(daily);
      },
    );
  }

  // Internal accounting entry point only. Public analytics cannot debit coins.
  async recordSpend(
    campaignId: string,
    coins: number,
    operationId: string,
    date = new Date(),
  ): Promise<void> {
    const amount = coinAmount(coins);
    if (amount <= 0n || !/^[a-zA-Z0-9_-]{1,100}$/.test(operationId))
      throw new BadRequestException(
        'Positive coins and an operation ID are required',
      );
    await this.mutateCampaign(
      campaignId,
      undefined,
      async (campaign, wallet, manager) => {
        const previous = await manager.findOneBy(BoostTransaction, {
          operationId,
        });
        if (previous) {
          if (
            previous.referenceId !== campaignId ||
            previous.type !== BoostTransactionType.CAMPAIGN_SPEND ||
            previous.amount !== String(-amount) ||
            previous.metadata?.date !== date.toISOString().slice(0, 10)
          )
            throw new BadRequestException('Operation ID was already used');
          return;
        }
        this.assertActive(campaign, date);
        await this.visibleCampaign(manager, campaign);
        const dateStr = date.toISOString().slice(0, 10);
        const daily =
          (await manager.findOneBy(BoostCampaignPerformance, {
            campaignId,
            date: dateStr,
          })) ??
          manager.create(BoostCampaignPerformance, {
            campaignId,
            date: dateStr,
            impressions: '0',
            clicks: '0',
            spendCoins: '0',
          });
        const spent = coinAmount(campaign.spentCoins) + amount;
        const today = coinAmount(daily.spendCoins) + amount;
        const before = coinAmount(wallet.balance);
        if (
          spent > coinAmount(campaign.budgetCoins) ||
          before < amount ||
          (campaign.dailyBudgetCoins &&
            today > coinAmount(campaign.dailyBudgetCoins))
        )
          throw new BadRequestException('Campaign budget exceeded');
        wallet.balance = String(before - amount);
        campaign.spentCoins = String(spent);
        daily.spendCoins = String(today);
        if (spent === coinAmount(campaign.budgetCoins)) {
          campaign.status = BoostCampaignStatus.COMPLETED;
          campaign.completedAt = new Date();
        }
        await manager.save(wallet);
        await manager.save(campaign);
        await manager.save(daily);
        await manager.insert(BoostTransaction, {
          id: uuidv4(),
          operationId,
          userId: campaign.userId,
          type: BoostTransactionType.CAMPAIGN_SPEND,
          amount: String(-amount),
          balanceBefore: String(before),
          balanceAfter: wallet.balance,
          referenceId: campaignId,
          referenceType: BoostTransactionReferenceType.CAMPAIGN,
          description: 'Campaign delivery',
          metadata: { date: dateStr },
        });
      },
    );
  }

  async getCampaignPerformance(
    campaignId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BoostCampaignPerformance[]> {
    const campaign = await this.getCampaign(campaignId, userId);
    return this.boostPerformanceRepo.find({
      where: {
        campaignId,
        date: Between(
          startDate.toISOString().slice(0, 10),
          endDate.toISOString().slice(0, 10),
        ),
      },
      order: { date: 'ASC' },
    });
  }

  async getCampaignPerformanceSummary(
    campaignId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    campaignId: string;
    dateRange: { start: string; end: string };
    totalImpressions: number;
    totalClicks: number;
    totalSpendCoins: number;
    avgCtr: number;
    avgCpcCoins: number;
    dailyData: Array<{
      date: string;
      impressions: number;
      clicks: number;
      spendCoins: number;
      ctr: number;
      cpcCoins: number;
    }>;
  }> {
    const data = await this.getCampaignPerformance(
      campaignId,
      userId,
      startDate,
      endDate,
    );
    const totalImpressions = data.reduce(
      (sum, d) => sum + parseInt(d.impressions, 10),
      0,
    );
    const totalClicks = data.reduce(
      (sum, d) => sum + parseInt(d.clicks, 10),
      0,
    );
    const totalSpendCoins = data.reduce(
      (sum, d) => sum + parseInt(d.spendCoins, 10),
      0,
    );
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const avgCpcCoins = totalClicks > 0 ? totalSpendCoins / totalClicks : 0;

    return {
      campaignId,
      dateRange: {
        start: startDate.toISOString().split('T')[0] ?? '',
        end: endDate.toISOString().split('T')[0] ?? '',
      },
      totalImpressions,
      totalClicks,
      totalSpendCoins,
      avgCtr,
      avgCpcCoins,
      dailyData: data.map((d) => ({
        date: d.date,
        impressions: parseInt(d.impressions, 10),
        clicks: parseInt(d.clicks, 10),
        spendCoins: parseInt(d.spendCoins, 10),
        ctr:
          parseInt(d.impressions, 10) > 0
            ? parseInt(d.clicks, 10) / parseInt(d.impressions, 10)
            : 0,
        cpcCoins:
          parseInt(d.clicks, 10) > 0
            ? parseInt(d.spendCoins, 10) / parseInt(d.clicks, 10)
            : 0,
      })),
    };
  }

  // ============================================
  // Feed Integration: Get Active Ads for User
  // ============================================

  async getActiveAdsForFeed(
    userId: string | undefined,
    location?: { lat: number; lng: number },
    interests?: string[],
    limit = 5,
  ): Promise<
    Array<{
      campaignId: string;
      targetType: BoostTargetType;
      targetId: string;
      targetName: string;
      targetSlug: string;
      targetStoreSlug?: string;
      targetImageKey?: string;
      creative?: BoostCreative;
      sponsoredBy: string;
      sponsoredById: string;
      cta?: string;
    }>
  > {
    const now = new Date();
    const qb = this.boostCampaignRepo
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.user', 'user')
      .where('campaign.status = :status', {
        status: BoostCampaignStatus.ACTIVE,
      })
      .andWhere('user.suspendedAt IS NULL')
      .andWhere('campaign.startAt <= :now', { now })
      .andWhere('(campaign.endAt IS NULL OR campaign.endAt > :now)', { now })
      .andWhere(
        'CAST(campaign.spent_coins AS UNSIGNED) < CAST(campaign.budget_coins AS UNSIGNED)',
      );

    // Daily budget check
    qb.andWhere(`
      (campaign.daily_budget_coins IS NULL OR
       (SELECT COALESCE(SUM(CAST(p.spend_coins AS UNSIGNED)), 0)
        FROM boost_campaign_performance p
        WHERE p.campaign_id = campaign.id AND p.date = UTC_DATE()) < CAST(campaign.daily_budget_coins AS UNSIGNED))
    `);

    // Targeting filters
    // Location-based
    if (location) {
      qb.andWhere(
        `
        (JSON_CONTAINS(campaign.targeting, JSON_ARRAY('LB'), '$.countries') OR
         campaign.targeting->>'$.countries' IS NULL OR
         JSON_LENGTH(campaign.targeting->'$.countries') = 0 OR
         (campaign.targeting->>'$.latitude' IS NOT NULL AND
          campaign.targeting->>'$.longitude' IS NOT NULL AND
          campaign.targeting->>'$.radiusKm' IS NOT NULL AND
          ST_Distance_Sphere(
            POINT(campaign.targeting->>'$.longitude', campaign.targeting->>'$.latitude'),
            POINT(:lng, :lat)
          ) <= CAST(campaign.targeting->>'$.radiusKm' AS UNSIGNED) * 1000))
      `,
        { lat: location.lat, lng: location.lng },
      );
    }

    // Interest-based
    if (interests && interests.length > 0) {
      const interestConditions = interests
        .map(
          (_, i) =>
            `JSON_CONTAINS(campaign.targeting, JSON_QUOTE(:interest${i}), '$.interests')`,
        )
        .join(' OR ');
      qb.andWhere(
        `(campaign.targeting->>'$.interests' IS NULL OR JSON_LENGTH(campaign.targeting->'$.interests') = 0 OR ${interestConditions})`,
      );
      interests.forEach((interest, i) =>
        qb.setParameter(`interest${i}`, interest),
      );
    }

    // Exclude user's own campaigns
    if (userId) {
      qb.andWhere('campaign.userId != :userId', { userId });
    }

    // Order by bid strategy and relevance
    qb.orderBy(
      'CASE WHEN campaign.bid_strategy = "cpm" THEN 0 WHEN campaign.bid_strategy = "cpc" THEN 1 ELSE 2 END',
    )
      .addOrderBy('CAST(campaign.bid_amount_coins AS UNSIGNED)', 'DESC')
      .addOrderBy('campaign.createdAt', 'DESC')
      .take(limit);

    const campaigns = await qb.getMany();

    // Enrich with target info
    const results = [];
    for (const campaign of campaigns) {
      let targetName = '';
      let targetSlug = '';
      let targetStoreSlug: string | undefined;
      let targetImageKey: string | undefined;

      if (campaign.targetType === BoostTargetType.SHOWCASE) {
        const showcase = await this.showcaseRepo.findOne({
          where: { id: campaign.targetId, ...publicWhere('post') },
          relations: ['store'],
        });
        if (!showcase || showcase.status !== 'published' || !showcase.storeId)
          continue;
        targetName = showcase.title;
        targetSlug = showcase.slug;
        targetStoreSlug = showcase.store?.slug;
        targetImageKey = await this.postPreviewKey(showcase.id);
      } else {
        const store = await this.storeRepo.findOne({
          where: { id: campaign.targetId, ...publicWhere('store') },
        });
        if (!store) continue;
        targetName = store.name;
        targetSlug = store.slug;
        targetStoreSlug = store.slug;
        targetImageKey = store.logoKey || undefined;
      }

      results.push({
        campaignId: campaign.id,
        targetType: campaign.targetType,
        targetId: campaign.targetId,
        targetName,
        targetSlug,
        targetStoreSlug,
        targetImageKey,
        creative: campaign.creative as BoostCreative | undefined,
        sponsoredBy: campaign.user?.displayName || 'Unknown',
        sponsoredById: campaign.userId,
        cta: campaign.creative?.callToAction || 'visit_store',
      });
    }

    return results;
  }

  // ============================================
  // Feed Integration: Trending boosted shops
  // ============================================

  async getTrendingStores(limit = 6): Promise<
    Array<{
      campaignId: string;
      id: string;
      name: string;
      slug: string;
      logoKey?: string;
      brandColor?: string;
      city?: string;
      country?: string;
      headline?: string;
      sponsoredBy: string;
      cta?: string;
    }>
  > {
    const now = new Date();
    const campaigns = await this.boostCampaignRepo
      .createQueryBuilder('campaign')
      .innerJoinAndSelect('campaign.targetStore', 'store')
      .where('campaign.targetType = :targetType', {
        targetType: BoostTargetType.STORE,
      })
      .andWhere('campaign.status = :status', {
        status: BoostCampaignStatus.ACTIVE,
      })
      .andWhere('campaign.startAt <= :now', { now })
      .andWhere('(campaign.endAt IS NULL OR campaign.endAt > :now)', { now })
      .andWhere(
        'CAST(campaign.spent_coins AS UNSIGNED) < CAST(campaign.budget_coins AS UNSIGNED)',
      )
      // Promoted shops obey the same daily cap as feed ads.
      .andWhere(
        `
        (campaign.daily_budget_coins IS NULL OR
         (SELECT COALESCE(SUM(CAST(p.spend_coins AS UNSIGNED)), 0)
          FROM boost_campaign_performance p
          WHERE p.campaign_id = campaign.id AND p.date = UTC_DATE()) < CAST(campaign.daily_budget_coins AS UNSIGNED))
      `,
      )
      .andWhere(publicVisibilitySql('store', 'store'))
      .orderBy('CAST(campaign.bid_amount_coins AS UNSIGNED)', 'DESC')
      .addOrderBy('campaign.createdAt', 'DESC')
      .take(Math.min(Math.max(limit * 4, limit), 50))
      .getMany();

    const stores: Array<{
      campaignId: string;
      id: string;
      name: string;
      slug: string;
      logoKey?: string;
      brandColor?: string;
      city?: string;
      country?: string;
      headline?: string;
      sponsoredBy: string;
      cta?: string;
    }> = [];
    const seen = new Set<string>();
    for (const campaign of campaigns) {
      const store = campaign.targetStore;
      if (!store || seen.has(store.id)) continue;
      seen.add(store.id);
      stores.push({
        campaignId: campaign.id,
        id: store.id,
        name: store.name,
        slug: store.slug,
        logoKey: store.logoKey ?? undefined,
        brandColor: store.brandColor ?? undefined,
        city: store.city ?? undefined,
        country: store.country ?? undefined,
        headline: campaign.creative?.headline,
        sponsoredBy: store.name,
        cta: campaign.creative?.callToAction || 'visit_store',
      });
      if (stores.length >= limit) break;
    }
    return stores;
  }

  // ============================================
  // Admin: Campaign Review
  // ============================================

  async adminReviewCampaign(
    campaignId: string,
    adminUserId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string,
  ): Promise<BoostCampaign> {
    const actor = actorContext(adminUserId);
    await requireAdmin(
      this.dataSource.manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
    if (!['approve', 'reject'].includes(action))
      throw new BadRequestException('Invalid review action');
    return this.mutateCampaign(
      campaignId,
      undefined,
      async (campaign, _wallet, manager) => {
        if (
          (action === 'approve' &&
            campaign.status === BoostCampaignStatus.ACTIVE) ||
          (action === 'reject' &&
            campaign.status === BoostCampaignStatus.REJECTED)
        )
          return campaign;
        if (campaign.status !== BoostCampaignStatus.PENDING_REVIEW) {
          throw new BadRequestException('Campaign is not pending review');
        }

        await requireAdmin(
          manager,
          actor,
          this.config.get('ADMIN_EMAILS', { infer: true }),
        );
        if (action === 'approve') {
          if (campaign.endAt && campaign.endAt <= new Date())
            throw new BadRequestException('Campaign has expired');
          await this.visibleCampaign(manager, campaign);
          campaign.status = BoostCampaignStatus.ACTIVE;
        } else {
          campaign.status = BoostCampaignStatus.REJECTED;
          campaign.rejectedAt = new Date();
          campaign.rejectionReason = rejectionReason || 'Rejected by admin';
        }

        const saved = await manager.save(campaign);
        await appendAdminAudit(
          manager,
          actor,
          'campaigns',
          campaign.id,
          `review.${action}`,
          ['status'],
        );
        return saved;
      },
    );
  }

  async adminGetAllCampaigns(
    status?: BoostCampaignStatus,
    limit = 50,
    offset = 0,
  ): Promise<{ campaigns: BoostCampaign[]; total: number }> {
    const qb = this.boostCampaignRepo
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.user', 'user');
    if (status) qb.andWhere('campaign.status = :status', { status });
    qb.orderBy('campaign.createdAt', 'DESC').take(limit).skip(offset);
    const [campaigns, total] = await qb.getManyAndCount();
    return { campaigns, total };
  }
}
