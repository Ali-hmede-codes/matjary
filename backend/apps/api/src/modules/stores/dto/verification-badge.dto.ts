import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class GrantVerificationBadgeDto {
  @IsString()
  @IsUUID()
  storeId!: string;
}

export class RevokeVerificationBadgeDto {
  @IsString()
  @IsUUID()
  storeId!: string;
}

export class CheckBadgeEligibilityResponseDto {
  eligible!: boolean;
  reason?: string;
  currentBadges!: number;
  maxBadges!: number | null;
  badgePriceCents!: number | null;
  // True when the current plan bundles a badge slot at no extra charge.
  included?: boolean;
}

export class BadgeOperationResponseDto {
  success!: boolean;
  error?: string;
  requiresPayment?: boolean;
  priceCents?: number;
}
