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
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SocialMediaLinks, StoreType } from '@app/database';
import { StoreBranchDto } from './store-branch.dto';

const HTTP_URL = /^https?:\/\//iu;

export class CreateSocialMediaLinksDto implements SocialMediaLinks {
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

export class CreateStoreLocationDto {
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

export class CreateStoreDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug?: string;

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
  @Type(() => CreateSocialMediaLinksDto)
  socialMediaLinks?: SocialMediaLinks | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateStoreLocationDto)
  location?: CreateStoreLocationDto | null;

  // Branches can be added right away, so a new shop can publish its address,
  // phone numbers, and hours in the same request.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => StoreBranchDto)
  branches?: StoreBranchDto[];

  // logoKey and bannerKey are set via media upload, not directly in create
}
