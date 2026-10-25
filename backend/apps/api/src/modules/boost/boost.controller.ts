import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { BoostService } from './boost.service';
import {
  BoostBalanceResponseDto,
  BoostTransactionResponseDto,
  BoostTransactionListResponseDto,
  BoostSettingsResponseDto,
  UpdateBoostSettingsDto,
  AdminAdjustBalanceDto,
  AdminAdjustBalanceResponseDto,
  CreateBoostCampaignDto,
  UpdateBoostCampaignDto,
  BoostCampaignResponseDto,
  BoostCampaignListResponseDto,
  BoostCampaignPerformanceResponseDto,
  BoostCampaignPerformanceSummaryDto,
  CampaignActionResponseDto,
  BoostedContentResponseDto,
  TrendingBoostStoreDto,
  BoostTargetingDto,
  BoostCreativeDto,
  ReviewCampaignDto,
} from './dto/boost-coin.dto';
import { BoostBidStrategy } from '@app/database';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  OptionalSessionGuard,
  AdminGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';

@Controller('boost')
export class BoostController {
  constructor(private readonly boostService: BoostService) {}

  // ============================================
  // Public Settings
  // ============================================

  @Get('settings/public')
  async getPublicSettings() {
    return this.boostService.getPublicSettings();
  }

  // ============================================
  // User: Balance & Transactions
  // ============================================

  @Get('balance')
  @UseGuards(SessionGuard)
  async getBalance(
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostBalanceResponseDto> {
    return this.boostService.getBalance(request.user.id);
  }

  @Get('transactions')
  @UseGuards(SessionGuard)
  async getTransactions(
    @Req() request: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<BoostTransactionListResponseDto> {
    const { transactions, total } = await this.boostService.getTransactions(
      request.user.id,
      Math.min(Math.max(limit, 1), 200),
      Math.max(offset, 0),
    );

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        amountNumber: parseInt(t.amount, 10),
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        referenceId: t.referenceId ?? undefined,
        referenceType: t.referenceType ?? undefined,
        description: t.description ?? undefined,
        metadata: t.metadata ?? undefined,
        createdAt: t.createdAt,
      })),
      total,
      limit: Math.min(Math.max(limit, 1), 200),
      offset: Math.max(offset, 0),
    };
  }

  // ============================================
  // User: Campaigns
  // ============================================

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async createCampaign(
    @Body() dto: CreateBoostCampaignDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostCampaignResponseDto> {
    const campaign = await this.boostService.createCampaign(request.user.id, {
      name: dto.name,
      targetType: dto.targetType,
      targetId: dto.targetId,
      budgetCoins: dto.budgetCoins,
      dailyBudgetCoins: dto.dailyBudgetCoins,
      bidStrategy: dto.bidStrategy ?? BoostBidStrategy.AUTO,
      bidAmountCoins: dto.bidAmountCoins,
      targeting: dto.targeting,
      creative: dto.creative,
      startAt: dto.startAt,
      endAt: dto.endAt,
    });

    return this.toCampaignResponse(campaign);
  }

  @Get('campaigns')
  @UseGuards(SessionGuard)
  async getCampaigns(
    @Req() request: AuthenticatedRequest,
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<BoostCampaignListResponseDto> {
    const { campaigns, total } = await this.boostService.getCampaigns(
      request.user.id,
      status as any,
      Math.min(Math.max(limit, 1), 100),
      Math.max(offset, 0),
    );

    return {
      campaigns: await Promise.all(
        campaigns.map((c) => this.toCampaignResponse(c)),
      ),
      total,
      limit: Math.min(Math.max(limit, 1), 100),
      offset: Math.max(offset, 0),
    };
  }

  @Get('campaigns/:campaignId')
  @UseGuards(SessionGuard)
  async getCampaign(
    @Param('campaignId') campaignId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostCampaignResponseDto> {
    const campaign = await this.boostService.getCampaign(
      campaignId,
      request.user.id,
    );
    return this.toCampaignResponse(campaign);
  }

  @Patch('campaigns/:campaignId')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async updateCampaign(
    @Param('campaignId') campaignId: string,
    @Body() dto: UpdateBoostCampaignDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostCampaignResponseDto> {
    const campaign = await this.boostService.updateCampaign(
      campaignId,
      request.user.id,
      dto,
    );
    return this.toCampaignResponse(campaign);
  }

  @Post('campaigns/:campaignId/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async pauseCampaign(
    @Param('campaignId') campaignId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CampaignActionResponseDto> {
    const campaign = await this.boostService.pauseCampaign(
      campaignId,
      request.user.id,
    );
    return { success: true, campaign: await this.toCampaignResponse(campaign) };
  }

  @Post('campaigns/:campaignId/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async resumeCampaign(
    @Param('campaignId') campaignId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CampaignActionResponseDto> {
    const campaign = await this.boostService.resumeCampaign(
      campaignId,
      request.user.id,
    );
    return { success: true, campaign: await this.toCampaignResponse(campaign) };
  }

  @Post('campaigns/:campaignId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async cancelCampaign(
    @Param('campaignId') campaignId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CampaignActionResponseDto> {
    const campaign = await this.boostService.cancelCampaign(
      campaignId,
      request.user.id,
    );
    return { success: true, campaign: await this.toCampaignResponse(campaign) };
  }

  // ============================================
  // Campaign Performance
  // ============================================

  @Get('campaigns/:campaignId/performance')
  @UseGuards(SessionGuard)
  async getCampaignPerformance(
    @Param('campaignId') campaignId: string,
    @Req() request: AuthenticatedRequest,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<BoostCampaignPerformanceSummaryDto> {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    const summary = await this.boostService.getCampaignPerformanceSummary(
      campaignId,
      request.user.id,
      start,
      end,
    );
    return {
      ...summary,
      dailyData: summary.dailyData.map((d) => ({ campaignId, ...d })),
    };
  }

  // ============================================
  // Feed Integration: Get Ads for Feed
  // ============================================

  @Get('feed/ads')
  @UseGuards(OptionalSessionGuard)
  async getFeedAds(
    @Req() request: AuthenticatedRequest,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('interests') interests?: string,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit?: number,
  ): Promise<BoostedContentResponseDto[]> {
    const userId = request.user?.id;
    const location =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;
    const interestList = interests ? interests.split(',') : undefined;

    const ads = await this.boostService.getActiveAdsForFeed(
      userId,
      location,
      interestList,
      Math.min(Math.max(limit ?? 5, 1), 10),
    );

    return ads.map((ad) => ({
      id: ad.campaignId,
      type: 'ad' as const,
      targetType: ad.targetType,
      targetId: ad.targetId,
      targetName: ad.targetName,
      targetSlug: ad.targetSlug,
      targetStoreSlug: ad.targetStoreSlug,
      targetImageKey: ad.targetImageKey,
      creative: ad.creative,
      sponsoredBy: ad.sponsoredBy,
      sponsoredById: ad.sponsoredById,
      cta: ad.cta,
    }));
  }

  @Get('trending/stores')
  async getTrendingStores(
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number,
  ): Promise<TrendingBoostStoreDto[]> {
    return this.boostService.getTrendingStores(
      Math.min(Math.max(limit, 1), 12),
    );
  }

  // Track ad impression (called by frontend when ad is shown)
  @Post('ads/:campaignId/impression')
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordImpression(
    @Param('campaignId') campaignId: string,
  ): Promise<void> {
    await this.boostService.recordImpression(campaignId);
  }

  // Track ad click (called by frontend when ad is clicked)
  @Post('ads/:campaignId/click')
  @UseGuards(AuthOriginGuard, AuthRateLimitGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordClick(@Param('campaignId') campaignId: string): Promise<void> {
    await this.boostService.recordClick(campaignId);
  }

  // ============================================
  // Admin: Settings
  // ============================================

  @Get('admin/settings')
  @UseGuards(SessionGuard, AdminGuard)
  async getAdminSettings(
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostSettingsResponseDto> {
    const settings = await this.boostService.getSettings();
    return {
      coinPriceCents: (settings.coin_price_cents as number) ?? 100,
      minPurchaseCoins: (settings.min_purchase_coins as number) ?? 100,
      maxPurchaseCoins: (settings.max_purchase_coins as number) ?? 100000,
      defaultDailyBudgetCoins:
        (settings.default_daily_budget_coins as number) ?? 1000,
      minCampaignBudgetCoins:
        (settings.min_campaign_budget_coins as number) ?? 100,
      maxCampaignDurationDays:
        (settings.max_campaign_duration_days as number) ?? 90,
      campaignReviewRequired:
        (settings.campaign_review_required as boolean) ?? true,
      autoApproveThresholdCoins:
        (settings.auto_approve_threshold_coins as number) ?? 1000,
      cpcMinBidCoins: (settings.cpc_min_bid_coins as number) ?? 1,
      cpmMinBidCoins: (settings.cpm_min_bid_coins as number) ?? 10,
      platformFeePercent: (settings.platform_fee_percent as number) ?? 0,
    };
  }

  @Patch('admin/settings')
  @UseGuards(SessionGuard, AdminGuard, AuthOriginGuard, AuthRateLimitGuard)
  async updateAdminSettings(
    @Body() dto: UpdateBoostSettingsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BoostSettingsResponseDto> {
    await this.boostService.updateSettings(
      dto as Record<string, unknown>,
      request.user.id,
    );
    return this.getAdminSettings(request);
  }

  // ============================================
  // Admin: User Balance Management
  // ============================================

  @Post('admin/balance/adjust')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AdminGuard, AuthOriginGuard, AuthRateLimitGuard)
  async adminAdjustBalance(
    @Body() dto: AdminAdjustBalanceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminAdjustBalanceResponseDto> {
    const { transaction, newBalance } =
      await this.boostService.adminAdjustBalance(
        request.user.id,
        dto.userId,
        dto.amount,
        dto.description || `Admin adjustment by ${request.user.id}`,
        dto.operationId,
        dto.metadata,
      );

    return {
      success: true,
      newBalance,
      transactionId: transaction.id,
    };
  }

  // ============================================
  // Admin: Campaign Review
  // ============================================

  @Get('admin/campaigns')
  @UseGuards(SessionGuard, AdminGuard)
  async adminGetAllCampaigns(
    @Req() request: AuthenticatedRequest,
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<BoostCampaignListResponseDto> {
    const { campaigns, total } = await this.boostService.adminGetAllCampaigns(
      status as any,
      Math.min(Math.max(limit, 1), 200),
      Math.max(offset, 0),
    );

    return {
      campaigns: await Promise.all(
        campaigns.map((c) => this.toCampaignResponse(c)),
      ),
      total,
      limit: Math.min(Math.max(limit, 1), 200),
      offset: Math.max(offset, 0),
    };
  }

  @Post('admin/campaigns/:campaignId/review')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AdminGuard, AuthOriginGuard, AuthRateLimitGuard)
  async adminReviewCampaign(
    @Param('campaignId') campaignId: string,
    @Body() body: ReviewCampaignDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CampaignActionResponseDto> {
    const campaign = await this.boostService.adminReviewCampaign(
      campaignId,
      request.user.id,
      body.action,
      body.rejectionReason,
    );

    return { success: true, campaign: await this.toCampaignResponse(campaign) };
  }

  // ============================================
  // Helper
  // ============================================

  private async toCampaignResponse(
    campaign: any,
  ): Promise<BoostCampaignResponseDto> {
    const {
      name: targetName,
      slug: targetSlug,
      imageKey: targetImageKey,
    } = await this.boostService.getCampaignTargetInfo(
      campaign.targetType,
      campaign.targetId,
    );

    const spent = parseInt(campaign.spentCoins, 10);
    const budget = parseInt(campaign.budgetCoins, 10);

    return {
      id: campaign.id,
      userId: campaign.userId,
      name: campaign.name,
      targetType: campaign.targetType,
      targetId: campaign.targetId,
      targetName,
      targetSlug,
      targetImageKey,
      status: campaign.status,
      budgetCoins: campaign.budgetCoins,
      spentCoins: campaign.spentCoins,
      remainingCoins: String(Math.max(0, budget - spent)),
      dailyBudgetCoins: campaign.dailyBudgetCoins ?? undefined,
      bidStrategy: campaign.bidStrategy,
      bidAmountCoins: campaign.bidAmountCoins ?? undefined,
      targeting: campaign.targeting,
      creative: campaign.creative,
      startAt: campaign.startAt,
      endAt: campaign.endAt,
      pausedAt: campaign.pausedAt ?? undefined,
      rejectedAt: campaign.rejectedAt ?? undefined,
      rejectionReason: campaign.rejectionReason ?? undefined,
      completedAt: campaign.completedAt ?? undefined,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }
}
