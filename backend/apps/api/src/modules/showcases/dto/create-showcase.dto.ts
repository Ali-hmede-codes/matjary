import {
  IsString,
  Length,
  Matches,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ShowcaseStatus } from '@app/database';

export class CreateShowcaseDto {
  @IsOptional()
  @IsString()
  @Length(1, 191)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug?: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsEnum(ShowcaseStatus)
  status?: ShowcaseStatus;

  @IsOptional()
  @IsUUID('4')
  storeId?: string;

  // Shoppable post: one of the shop's products or one of its categories.
  @IsOptional()
  @IsUUID('4')
  linkedProductId?: string | null;

  @IsOptional()
  @IsUUID('4')
  linkedCategoryId?: string | null;
}
