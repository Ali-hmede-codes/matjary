import {
  IsString,
  IsOptional,
  IsInt,
  Max,
  IsIn,
  Min,
  MaxLength,
  IsEnum,
  IsObject,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingCycle, SubscriptionLimits } from '@app/database';

export class CreateSubscriptionLimitsDto implements Partial<SubscriptionLimits> {
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxVideoDurationSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxVideoSizeBytes?: number | null;

  @IsOptional()
  @IsString()
  @IsIn(['480p', '720p', '1080p', '4k', '8k'])
  maxVideoQuality?: string | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxImageCount?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxImageSizeBytes?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxImageWidth?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxImageHeight?: number | null;

  // Legacy monthly quota; accepted for compatibility and normalized to null.
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxPostsPerMonth?: number | null;

  // Maximum posts across the account.
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxTotalPosts?: number | null;

  // Maximum shops across the account.
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxShops?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxProducts?: number | null;

  // Live stories a shop may keep at once; 0 = no stories, null = unlimited.
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxStories?: number | null;

  // Maximum custom categories across every owned shop.
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxCategories?: number | null;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxStorageBytes?: number | null;

  @IsOptional()
  @IsBoolean()
  enableCart?: boolean;

  @IsOptional()
  @IsBoolean()
  enableWhatsAppCheckout?: boolean;

  @IsOptional()
  @IsBoolean()
  enableAnalytics?: boolean;

  @IsOptional()
  @IsBoolean()
  enableCustomDomain?: boolean;

  @IsOptional()
  @IsBoolean()
  enablePrioritySupport?: boolean;

  // Verification Badge limits
  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  maxVerificationBadges?: number | null; // 0 = no badges, null = unlimited

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  verificationBadgePriceCents?: number | null; // price per badge in cents, 0 = free
}

export class CreateSubscriptionPlanDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(100)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @IsObject()
  @ValidateNested()
  @Type(() => CreateSubscriptionLimitsDto)
  limits!: CreateSubscriptionLimitsDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Max(Number.MAX_SAFE_INTEGER)
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  legacyTier?: string; // 'free' | 'basic' | 'premium'
}
