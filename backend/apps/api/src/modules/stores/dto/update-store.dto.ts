import {
  IsString,
  Length,
  IsOptional,
  IsHexColor,
  IsObject,
  ValidateNested,
  IsUrl,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SocialMediaLinks, StoreType } from '@app/database';

export class UpdateSocialMediaLinksDto implements SocialMediaLinks {
  @IsOptional()
  @IsString()
  @IsUrl()
  instagram?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  facebook?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  twitter?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  tiktok?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  youtube?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
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

  @IsOptional()
  @IsString()
  @Length(0, 512)
  logoKey?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 512)
  bannerKey?: string | null;
}
