import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { StoreCategory } from '@app/database';

// Category images are links, not uploads. Only absolute http(s) URLs are
// accepted: a `javascript:` or `data:` value is rejected at the API boundary,
// and the storefront can safely hand the rest to a plain <img>. An empty string
// clears the image, exactly like null.
const trimmedUrl = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  );

const urlShape = () =>
  IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
    disallow_auth: true,
  });

export class CreateCategoryDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4294967295)
  sortOrder?: number;

  @trimmedUrl()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @urlShape()
  imageUrl?: string | null;
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

  @trimmedUrl()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @urlShape()
  imageUrl?: string | null;
}

export class CategoryResponseDto {
  id!: string;
  name!: string;
  sortOrder!: number;
  // Direct image link for the storefront's category cards; null means the
  // typographic fallback (or the owner removed the picture).
  imageUrl!: string | null;
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
    dto.imageUrl = category.imageUrl ?? null;
    dto.productCount = productCount;
    return dto;
  }
}

export class CategoryListResponseDto {
  items!: CategoryResponseDto[];
  total!: number;
  // Owner view only; null means unlimited.
  limit?: number | null;
  // Public view: active products without an owner-defined category. The
  // storefront lists them under a final "More items" section.
  uncategorized?: number;
}
