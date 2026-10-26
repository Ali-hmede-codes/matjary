import {
  IsString,
  Length,
  Matches,
  IsOptional,
  IsInt,
  Max,
  ArrayMaxSize,
  IsBoolean,
  Min,
  IsEnum,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductCategory, ProductStatus } from '@app/database';
import { ProductOptionGroupDto } from './product-option.dto';

export class CreateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 191)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug?: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(ProductCategory)
  category?: ProductCategory;

  // Owner-defined shop category. Null clears the assignment on update.
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

  // Optional choices shown before adding the product to a cart. Sending null
  // (or an empty list) removes all options on update.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupDto)
  options?: ProductOptionGroupDto[] | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;
}
