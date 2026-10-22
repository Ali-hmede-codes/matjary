import {
  IsString,
  Length,
  IsOptional,
  IsNumber,
  Min,
  IsEnum,
  IsArray,
  IsUrl,
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
  @IsNumber()
  @Min(0)
  priceCents?: number;

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
