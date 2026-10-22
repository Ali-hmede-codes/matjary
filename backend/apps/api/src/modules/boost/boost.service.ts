import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  In,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
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
} from '@app/database';

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
  ) {}

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
    for (const [key, value] of Object.entries(dto)) {
      await this.boostSettingRepo.upsert(
        {
          key,
          value: value as Record<string, unknown>,
          updatedBy: adminUserId,
        } as any,
        ['key'],
      );
    }
    this.settingsCache.clear(); // Invalidate cache
  }

  async getPublicSettings(): Promise<{
    coinPriceCents: number;
    minPurchaseCoins: number;
    maxPurchaseCoins: number;
  }> {
    return {
      coinPriceCents: await this.getCoinPriceCents(),
      minPurchaseCoins: await this.getMinPurchaseCoins(),
      maxPurchaseCoins: await this.getMaxPurchaseCoins(),
    };
  }

  // ============================================
  // Boost Coin Balance
  // ============================================

  async getOrCreateBalance(userId: string): Promise<BoostCoin> {
    let balance = await this.boostCoinRepo.findOne({ where: { userId } });
    if (!balance) {
      balance = this.boostCoinRepo.create({ userId, balance: '0' });
      await this.boostCoinRepo.save(balance);
    }
    return balance;
  }

  async getBalance(userId: string): Promise<{
    balance: string;
    balanceNumber: number;
    pendingSpend: string;
    availableBalance: string;
    availableBalanceNumber: number;
  }> {
    const balance = await this.getOrCreateBalance(userId);
    const pendingSpend = await this.getPendingSpend(userId);
    const balanceNum = parseInt(balance.balance, 10);
    const pendingNum = parseInt(pendingSpend, 10);
    const availableBalanceNumber = Math.max(0, balanceNum - pendingNum);
    return {
      balance: balance.balance,
      balanceNumber: balanceNum,
      pendingSpend,
      availableBalance: String(availableBalanceNumber),
      availableBalanceNumber,
    };
  }

  private async getPendingSpend(userId: string): Promise<string> {
    // Sum of (budget - spent) for active campaigns
    const campaigns = await this.boostCampaignRepo
      .createQueryBuilder('campaign')
      .where('campaign.userId = :userId', { userId })
      .andWhere('campaign.status IN (:...statuses)', {
        statuses: [
          BoostCampaignStatus.ACTIVE,
          BoostCampaignStatus.PENDING_REVIEW,
        ],
      })
      .select(
        'SUM(CAST(campaign.budget_coins AS UNSIGNED) - CAST(campaign.spent_coins AS UNSIGNED))',
        'pending',
      )
      .getRawOne();
    return campaigns?.pending || '0';
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
    queryRunner?: any,
  ): Promise<BoostTransaction> {
    const balance = await this.getOrCreateBalance(userId);
    const balanceBefore = parseInt(balance.balance, 10);
    const balanceAfter = balanceBefore + amount;

    if (balanceAfter < 0) {
      throw new BadRequestException('Insufficient boost coin balance');
    }

    const transaction = this.boostTransactionRepo.create({
      id: uuidv4(),
      userId,
      type,
      amount: String(amount),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      referenceId,
      referenceType,
      description,
      metadata,
    });

    // Update balance
    balance.balance = String(balanceAfter);

    const repo = queryRunner
      ? queryRunner.manager.getRepository(BoostTransaction)
      : this.boostTransactionRepo;
    const balanceRepo = queryRunner
      ? queryRunner.manager.getRepository(BoostCoin)
      : this.boostCoinRepo;

    await repo.save(transaction);
    await balanceRepo.save(balance);

    return transaction;
  }

  async addCoins(
    userId: string,
    amount: number,
    referenceId: string | null,
    referenceType: BoostTransactionReferenceType,
    description: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<BoostTransaction> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.createTransaction(
      userId,
      BoostTransactionType.PURCHASE,
      amount,
      referenceId,
      referenceType,
      description,
      metadata,
    );
  }

  async spendCoins(
    userId: string,
    amount: number,
    campaignId: string,
    description: string,
  ): Promise<BoostTransaction> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.createTransaction(
      userId,
      BoostTransactionType.CAMPAIGN_SPEND,
      -amount,
      campaignId,
      BoostTransactionReferenceType.CAMPAIGN,
      description,
      null,
    );
  }

  async refundCoins(
    userId: string,
    amount: number,
    campaignId: string,
    description: string,
  ): Promise<BoostTransaction> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.createTransaction(
      userId,
      BoostTransactionType.REFUND,
      amount,
      campaignId,
      BoostTransactionReferenceType.CAMPAIGN,
      description,
      null,
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
    metadata: Record<string, unknown> | null = null,
  ): Promise<{ transaction: BoostTransaction; newBalance: string }> {
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
    );

    const balance = await this.getOrCreateBalance(targetUserId);
    return { transaction, newBalance: balance.balance };
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
        where: { id: targetId },
        relations: ['store'],
      });
      if (!showcase) throw new NotFoundException('Showcase not found');
      if (showcase.ownerId !== userId)
        throw new ForbiddenException('You can only boost your own showcases');
      if (showcase.status !== 'published')
        throw new BadRequestException(
          'Only published showcases can be boosted',
        );
      return {
        name: showcase.title,
        slug: showcase.slug,
        imageKey: showcase.mediaAssets?.[0]?.originalKey ?? undefined,
      };
    } else {
      const store = await this.storeRepo.findOne({ where: { id: targetId } });
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
          imageKey: undefined,
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
    const budgetCoins = parseInt(dto.budgetCoins, 10);
    const minBudget = await this.getMinCampaignBudgetCoins();
    if (budgetCoins < minBudget) {
      throw new BadRequestException(
        `Minimum campaign budget is ${minBudget} coins`,
      );
    }

    // Check user balance
    const balance = await this.getBalance(userId);
    if (balance.availableBalanceNumber < budgetCoins) {
      throw new BadRequestException(
        'Insufficient boost coin balance for campaign budget',
      );
    }

    // Validate dates
    const now = new Date();
    const startAt = dto.startAt || now;
    const maxDuration = await this.getMaxCampaignDurationDays();
    const maxEndAt = new Date(
      now.getTime() + maxDuration * 24 * 60 * 60 * 1000,
    );

    if (dto.endAt && dto.endAt > maxEndAt) {
      throw new BadRequestException(
        `Campaign duration cannot exceed ${maxDuration} days`,
      );
    }

    // Validate bid amounts
    if (dto.bidStrategy === BoostBidStrategy.CPC) {
      const minBid = await this.getCpcMinBidCoins();
      if (!dto.bidAmountCoins || parseInt(dto.bidAmountCoins, 10) < minBid) {
        throw new BadRequestException(`Minimum CPC bid is ${minBid} coins`);
      }
    } else if (dto.bidStrategy === BoostBidStrategy.CPM) {
      const minBid = await this.getCpmMinBidCoins();
      if (!dto.bidAmountCoins || parseInt(dto.bidAmountCoins, 10) < minBid) {
        throw new BadRequestException(`Minimum CPM bid is ${minBid} coins`);
      }
    }

    // Determine initial status
    const reviewRequired = await this.isCampaignReviewRequired();
    const autoApproveThreshold = await this.getAutoApproveThresholdCoins();
    let status = BoostCampaignStatus.DRAFT;

    if (reviewRequired && budgetCoins > autoApproveThreshold) {
      status = BoostCampaignStatus.PENDING_REVIEW;
    } else {
      status = BoostCampaignStatus.ACTIVE;
    }

    // Reserve budget by creating spend transaction
    // Note: We don't actually spend until impressions are served, but we reserve
    // For now, we'll just track it via pendingSpend

    const campaign = this.boostCampaignRepo.create({
      id: uuidv4(),
      userId,
      name: dto.name,
      targetType: dto.targetType,
      targetId: dto.targetId,
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

    return this.boostCampaignRepo.save(campaign);
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
    const campaign = await this.getCampaign(campaignId, userId);

    // Only allow updates for draft or pending_review campaigns
    if (
      ![BoostCampaignStatus.DRAFT, BoostCampaignStatus.PENDING_REVIEW].includes(
        campaign.status,
      )
    ) {
      throw new BadRequestException(
        'Cannot update active or completed campaigns',
      );
    }

    // Validate budget increase
    if (dto.budgetCoins) {
      const newBudget = parseInt(dto.budgetCoins, 10);
      const oldBudget = parseInt(campaign.budgetCoins, 10);
      if (newBudget < oldBudget) {
        throw new BadRequestException('Cannot reduce campaign budget');
      }
      const additional = newBudget - oldBudget;
      const balance = await this.getBalance(userId);
      if (balance.availableBalanceNumber < additional) {
        throw new BadRequestException(
          'Insufficient balance for budget increase',
        );
      }
    }

    // Validate dates
    if (dto.endAt) {
      const maxDuration = await this.getMaxCampaignDurationDays();
      const maxEndAt = new Date(Date.now() + maxDuration * 24 * 60 * 60 * 1000);
      if (dto.endAt > maxEndAt) {
        throw new BadRequestException(
          `Campaign duration cannot exceed ${maxDuration} days`,
        );
      }
    }

    Object.assign(campaign, dto);
    return this.boostCampaignRepo.save(campaign);
  }

  async pauseCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    const campaign = await this.getCampaign(campaignId, userId);
    if (campaign.status !== BoostCampaignStatus.ACTIVE) {
      throw new BadRequestException('Only active campaigns can be paused');
    }
    campaign.status = BoostCampaignStatus.PAUSED;
    campaign.pausedAt = new Date();
    return this.boostCampaignRepo.save(campaign);
  }

  async resumeCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    const campaign = await this.getCampaign(campaignId, userId);
    if (campaign.status !== BoostCampaignStatus.PAUSED) {
      throw new BadRequestException('Only paused campaigns can be resumed');
    }
    // Check if campaign has expired
    if (campaign.endAt && campaign.endAt < new Date()) {
      throw new BadRequestException('Campaign has expired');
    }
    // Check budget
    const spent = parseInt(campaign.spentCoins, 10);
    const budget = parseInt(campaign.budgetCoins, 10);
    if (spent >= budget) {
      throw new BadRequestException('Campaign budget exhausted');
    }
    campaign.status = BoostCampaignStatus.ACTIVE;
    campaign.pausedAt = null;
    return this.boostCampaignRepo.save(campaign);
  }

  async cancelCampaign(
    campaignId: string,
    userId: string,
  ): Promise<BoostCampaign> {
    const campaign = await this.getCampaign(campaignId, userId);
    if (
      [BoostCampaignStatus.COMPLETED, BoostCampaignStatus.CANCELLED].includes(
        campaign.status,
      )
    ) {
      throw new BadRequestException('Campaign already finished');
    }
    campaign.status = BoostCampaignStatus.CANCELLED;
    campaign.completedAt = new Date();
    // Refund unspent budget
    const unspent =
      parseInt(campaign.budgetCoins, 10) - parseInt(campaign.spentCoins, 10);
    if (unspent > 0) {
      await this.refundCoins(
        userId,
        unspent,
        campaignId,
        `Campaign cancelled: ${campaign.name}`,
      );
    }
    return this.boostCampaignRepo.save(campaign);
  }

  // ============================================
  // Campaign Performance
  // ============================================

  async recordImpression(
    campaignId: string,
    date: Date = new Date(),
  ): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    await this.boostPerformanceRepo
      .createQueryBuilder()
      .insert()
      .into(BoostCampaignPerformance)
      .values({
        campaignId,
        date: dateStr,
        impressions: '1',
      })
      .orUpdate(['impressions'], ['campaign_id', 'date'])
      .execute();
  }

  async recordClick(
    campaignId: string,
    date: Date = new Date(),
  ): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    await this.boostPerformanceRepo
      .createQueryBuilder()
      .insert()
      .into(BoostCampaignPerformance)
      .values({
        campaignId,
        date: dateStr,
        clicks: '1',
      })
      .orUpdate(['clicks'], ['campaign_id', 'date'])
      .execute();
  }

  async recordSpend(
    campaignId: string,
    coins: number,
    date: Date = new Date(),
  ): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    await this.boostPerformanceRepo
      .createQueryBuilder()
      .insert()
      .into(BoostCampaignPerformance)
      .values({
        campaignId,
        date: dateStr,
        spendCoins: String(coins),
      })
      .orUpdate(['spend_coins'], ['campaign_id', 'date'])
      .execute();

    // Also update campaign spent_coins
    await this.boostCampaignRepo.increment(
      { id: campaignId },
      'spentCoins',
      coins,
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
        date: Between(startDate, endDate),
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
        date: d.date.toISOString().split('T')[0] ?? '',
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
        WHERE p.campaign_id = campaign.id AND p.date = CURDATE()) < CAST(campaign.daily_budget_coins AS UNSIGNED))
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
      let targetImageKey: string | undefined;

      if (campaign.targetType === BoostTargetType.SHOWCASE) {
        const showcase = await this.showcaseRepo.findOne({
          where: { id: campaign.targetId },
        });
        if (showcase) {
          targetName = showcase.title;
          targetSlug = showcase.slug;
        }
      } else {
        const store = await this.storeRepo.findOne({
          where: { id: campaign.targetId },
        });
        if (store) {
          targetName = store.name;
          targetSlug = store.slug;
          targetImageKey = store.logoKey || undefined;
        }
      }

      results.push({
        campaignId: campaign.id,
        targetType: campaign.targetType,
        targetId: campaign.targetId,
        targetName,
        targetSlug,
        targetImageKey,
        creative: campaign.creative as BoostCreative | undefined,
        sponsoredBy: campaign.user?.displayName || 'Unknown',
        sponsoredById: campaign.userId,
        cta: campaign.creative?.callToAction || 'shop_now',
      });
    }

    return results;
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
    const campaign = await this.boostCampaignRepo.findOne({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== BoostCampaignStatus.PENDING_REVIEW) {
      throw new BadRequestException('Campaign is not pending review');
    }

    if (action === 'approve') {
      campaign.status = BoostCampaignStatus.ACTIVE;
    } else {
      campaign.status = BoostCampaignStatus.REJECTED;
      campaign.rejectedAt = new Date();
      campaign.rejectionReason = rejectionReason || 'Rejected by admin';
    }

    return this.boostCampaignRepo.save(campaign);
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
