import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { StoreCategory } from '@app/database';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  sortOrder?: number;
}

export class CategoryResponseDto {
  id!: string;
  name!: string;
  sortOrder!: number;
  // Present for owners: every product row that still references the category.
  productCount?: number;

  static fromEntity(
    category: StoreCategory,
    productCount?: number,
  ): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.sortOrder = category.sortOrder;
    dto.productCount = productCount;
    return dto;
  }
}

export class CategoryListResponseDto {
  items!: CategoryResponseDto[];
  total!: number;
  // Owner view only; null means unlimited.
  limit?: number | null;
}
