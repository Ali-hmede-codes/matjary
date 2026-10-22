import {
  IsString,
  Length,
  Matches,
  IsOptional,
  IsNumber,
  Min,
  IsEnum,
  IsArray,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductCategory, ProductStatus } from '@app/database';

export class CreateProductDto {
  @IsString()
  @Length(1, 191)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsNumber()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(ProductCategory)
  category?: ProductCategory;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  sku?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightGrams?: number | null;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageKeys?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[] | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  requiresShipping?: boolean;
}
