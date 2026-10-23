import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  Min,
  Max,
  IsEnum,
  IsBoolean,
  ValidateNested,
  IsArray,
  IsObject,
  IsInt,
  MaxLength,
  Length,
  Matches,
  IsDate,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BoostTransactionType,
  BoostCampaignStatus,
  BoostTargetType,
  BoostBidStrategy,
} from '@app/database';

// ============================================
// Boost Coin Balance & Transactions
// ============================================

export class BoostBalanceResponseDto {
  balance!: string; // Coins as string (BIGINT)
  balanceNumber!: number; // For convenience
  pendingSpend!: string; // Coins reserved for active campaigns
  availableBalance!: string; // balance - pendingSpend
}

export class BoostTransactionResponseDto {
  id!: string;
  type!: BoostTransactionType;
  amount!: string; // Signed amount
  amountNumber!: number;
  balanceBefore!: string;
  balanceAfter!: string;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt!: Date;
}

export class BoostTransactionListResponseDto {
  transactions!: BoostTransactionResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

// ============================================
// Boost Settings (Admin)
// ============================================

export class BoostSettingsResponseDto {
  coinPriceCents!: number;
  minPurchaseCoins!: number;
  maxPurchaseCoins!: number;
  defaultDailyBudgetCoins!: number;
  minCampaignBudgetCoins!: number;
  maxCampaignDurationDays!: number;
  campaignReviewRequired!: boolean;
  autoApproveThresholdCoins!: number;
  cpcMinBidCoins!: number;
  cpmMinBidCoins!: number;
  platformFeePercent!: number;
}

export class UpdateBoostSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  coinPriceCents?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minPurchaseCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxPurchaseCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  defaultDailyBudgetCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minCampaignBudgetCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  maxCampaignDurationDays?: number;

  @IsOptional()
  @IsBoolean()
  campaignReviewRequired?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  autoApproveThresholdCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  cpcMinBidCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  cpmMinBidCoins?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  platformFeePercent?: number;
}

// ============================================
// Admin: User Balance Management
// ============================================

export class AdminAdjustBalanceDto {
  @IsUUID()
  operationId!: string;

  @IsString()
  @IsUUID()
  userId!: string;

  @IsInt()
  @Min(-Number.MAX_SAFE_INTEGER)
  @Max(Number.MAX_SAFE_INTEGER)
  amount!: number; // Positive to add, negative to deduct

  @IsString()
  @Length(3, 500)
  description!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReviewCampaignDto {
  @IsEnum({ approve: 'approve', reject: 'reject' })
  action!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class AdminAdjustBalanceResponseDto {
  success!: boolean;
  newBalance!: string;
  transactionId!: string;
}

// ============================================
// Boost Campaign DTOs
// ============================================

export class BoostTargetingDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  districts?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm?: number;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsNumber()
  @Min(13)
  ageMin?: number;

  @IsOptional()
  @IsNumber()
  @Max(100)
  ageMax?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genders?: ('male' | 'female' | 'other')[];

  @IsOptional()
  @IsString()
  @IsUUID()
  lookalikeOfStoreId?: string;

  @IsOptional()
  @IsBoolean()
  retargeting?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  devices?: ('mobile' | 'desktop' | 'tablet')[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: ('web' | 'ios' | 'android')[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  daysOfWeek?: number[]; // 0-6

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  hoursOfDay?: number[]; // 0-23 UTC
}

export class BoostCreativeDto {
  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['shop_now', 'learn_more', 'visit_store', 'contact', 'book_now'])
  callToAction?:
    'shop_now' | 'learn_more' | 'visit_store' | 'contact' | 'book_now';

  @IsOptional()
  @IsString()
  mediaKey?: string;

  @IsOptional()
  @IsString()
  displayUrl?: string;
}

export class CreateBoostCampaignDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsEnum(BoostTargetType)
  targetType!: BoostTargetType;

  @IsString()
  @IsUUID()
  targetId!: string;

  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  budgetCoins!: string;

  @IsOptional()
  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  dailyBudgetCoins?: string;

  @IsOptional()
  @IsEnum(BoostBidStrategy)
  bidStrategy?: BoostBidStrategy;

  @IsOptional()
  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  bidAmountCoins?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BoostTargetingDto)
  targeting!: BoostTargetingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoostCreativeDto)
  creative?: BoostCreativeDto;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startAt?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endAt?: Date;
}

export class UpdateBoostCampaignDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  budgetCoins?: string;

  @IsOptional()
  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  dailyBudgetCoins?: string;

  @IsOptional()
  @IsEnum(BoostBidStrategy)
  bidStrategy?: BoostBidStrategy;

  @IsOptional()
  @IsString() // BIGINT as string
  @Matches(/^(0|[1-9]\d{0,15})$/)
  bidAmountCoins?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoostTargetingDto)
  targeting?: BoostTargetingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoostCreativeDto)
  creative?: BoostCreativeDto;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startAt?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endAt?: Date;
}

export class BoostCampaignResponseDto {
  id!: string;
  userId!: string;
  name!: string;
  targetType!: BoostTargetType;
  targetId!: string;
  targetName?: string; // Store name or Showcase title
  targetSlug?: string;
  targetImageKey?: string;
  status!: BoostCampaignStatus;
  budgetCoins!: string;
  spentCoins!: string;
  remainingCoins!: string;
  dailyBudgetCoins?: string;
  bidStrategy!: BoostBidStrategy;
  bidAmountCoins?: string;
  targeting!: BoostTargetingDto;
  creative?: BoostCreativeDto;
  startAt?: Date;
  endAt?: Date;
  pausedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  completedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
  // Performance summary
  totalImpressions?: number;
  totalClicks?: number;
  ctr?: number; // Click-through rate
  avgCpcCoins?: number; // Average cost per click in coins
}

export class BoostCampaignListResponseDto {
  campaigns!: BoostCampaignResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class BoostCampaignPerformanceResponseDto {
  campaignId!: string;
  date!: string; // YYYY-MM-DD
  impressions!: number;
  clicks!: number;
  spendCoins!: number;
  ctr?: number;
  cpcCoins?: number;
}

export class BoostCampaignPerformanceSummaryDto {
  campaignId!: string;
  dateRange!: { start: string; end: string };
  totalImpressions!: number;
  totalClicks!: number;
  totalSpendCoins!: number;
  avgCtr!: number;
  avgCpcCoins!: number;
  dailyData!: BoostCampaignPerformanceResponseDto[];
}

// ============================================
// Campaign Actions
// ============================================

export class CampaignActionResponseDto {
  success!: boolean;
  campaign?: BoostCampaignResponseDto;
  error?: string;
}

// ============================================
// Feed Integration - Boosted Content
// ============================================

export class BoostedContentResponseDto {
  id!: string; // Campaign ID
  type!: 'ad';
  targetType!: BoostTargetType;
  targetId!: string;
  targetName!: string;
  targetSlug!: string;
  targetImageKey?: string;
  creative?: BoostCreativeDto;
  // Ad metadata
  sponsoredBy!: string; // Store/user name
  sponsoredById!: string;
  cta?: string;
}
