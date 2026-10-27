import {
  IsString,
  Length,
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { ShowcaseStatus } from '@app/database';

export class UpdateShowcaseDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsEnum(ShowcaseStatus)
  status?: ShowcaseStatus;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;

  // Shoppable post: one of the shop's products or one of its categories.
  @IsOptional()
  @IsUUID('4')
  linkedProductId?: string | null;

  @IsOptional()
  @IsUUID('4')
  linkedCategoryId?: string | null;
}
