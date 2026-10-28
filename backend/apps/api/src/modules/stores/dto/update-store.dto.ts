import {
  IsString,
  Length,
  Matches,
  IsOptional,
  IsHexColor,
  IsObject,
  ValidateNested,
  IsUrl,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SocialMediaLinks, StoreType } from '@app/database';
import { StoreBranchDto } from './store-branch.dto';
import { StoreDesignSettingsDto } from './store-design.dto';

const HTTP_URL = /^https?:\/\//iu;

export class UpdateSocialMediaLinksDto implements SocialMediaLinks {
  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  instagram?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  facebook?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  twitter?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  tiktok?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  youtube?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  website?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  @Matches(HTTP_URL)
  telegram?: string;
}

export class UpdateStoreLocationDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  country?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  locationName?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @IsUrl()
  website?: string | null;

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string> | null;
}

export class UpdateStoreDto {
  @IsOptional()
  @IsBoolean()
  enableCart?: boolean;

  @IsOptional()
  @IsBoolean()
  enableWhatsAppCheckout?: boolean;

  // Display-only currency hint for the public shop. Stored prices stay in USD.
  @IsOptional()
  @IsBoolean()
  showPricesInLbp?: boolean;

  // Turning a section back on is subject to the shared allowance; the service
  // rejects a re-open when the plan has no free slot left.
  @IsOptional()
  @IsBoolean()
  enablePostsSection?: boolean;

  @IsOptional()
  @IsBoolean()
  enableProductsSection?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsHexColor()
  brandColor?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  // Business taxonomy slug from the shared catalog (restaurant, school, ...).
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9_]+$/u)
  businessCategory?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateSocialMediaLinksDto)
  socialMediaLinks?: SocialMediaLinks | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateStoreLocationDto)
  location?: UpdateStoreLocationDto | null;

  // The design studio's complete visual system. Null clears it and returns the
  // shop to the default storefront look.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StoreDesignSettingsDto)
  designSettings?: StoreDesignSettingsDto | null;

  // The complete branch list, in display order. Omitted ids are deleted and
  // new entries are created inside the same locked store transaction.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => StoreBranchDto)
  branches?: StoreBranchDto[];

  @IsOptional()
  @IsString()
  @Length(0, 512)
  logoKey?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 512)
  bannerKey?: string | null;
}
