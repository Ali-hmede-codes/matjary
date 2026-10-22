import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  Min,
  Max,
  IsPositive,
} from 'class-validator';
import { MediaKind } from '@app/database';

export class PresignedUrlDto {
  @IsString()
  @Min(1)
  @Max(255)
  fileName!: string;

  @IsString()
  @Min(1)
  fileType!: string;

  @IsPositive()
  @Max(209715200)
  fileSize!: number;

  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsOptional()
  @IsUUID('4')
  storeId?: string;
}
