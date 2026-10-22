import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
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
  @IsNumber()
  @IsPositive()
  maxVideoDurationSeconds?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxVideoSizeBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  maxVideoQuality?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxImageCount?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxImageSizeBytes?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxImageWidth?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxImageHeight?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxPostsPerMonth?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxTotalPosts?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxProducts?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxStorageBytes?: number;

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
  @IsNumber()
  @Min(0)
  maxVerificationBadges?: number; // 0 = no badges, null = unlimited

  @IsOptional()
  @IsNumber()
  @Min(0)
  verificationBadgePriceCents?: number; // price per badge in cents, 0 = free
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
  @IsNumber()
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
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  legacyTier?: string; // 'free' | 'basic' | 'premium'
}
