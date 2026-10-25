import {
  IsString,
  Length,
  IsOptional,
  IsInt,
  Max,
  ArrayMaxSize,
  IsBoolean,
  Min,
  IsEnum,
  IsArray,
  IsUrl,
  IsUUID,
} from 'class-validator';
import { ProductCategory, ProductStatus } from '@app/database';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  priceCents?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(ProductCategory)
  category?: ProductCategory;

  // Owner-defined shop category. Null clears the assignment.
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  sku?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  stockQuantity?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  weightGrams?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 512, { each: true })
  imageKeys?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @Length(1, 100, { each: true })
  tags?: string[] | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;
}
