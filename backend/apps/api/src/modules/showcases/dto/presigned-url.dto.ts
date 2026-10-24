import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  Min,
  Max,
  IsPositive,
  IsInt,
  Length,
  IsIn,
} from 'class-validator';
import { MediaKind, type MediaAsset } from '@app/database';

export class PresignedUrlDto {
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsIn([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
  ])
  fileType!: string;

  @IsPositive()
  @IsInt()
  @Max(209715200)
  fileSize!: number;

  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsOptional()
  @IsUUID('4')
  storeId?: string;
}

export class OwnerUploadDto extends PresignedUrlDto {
  @IsUUID('4')
  targetId!: string;

  @IsIn(['post', 'store_logo', 'store_banner', 'product_image'])
  purpose!: MediaAsset['purpose'];
}
