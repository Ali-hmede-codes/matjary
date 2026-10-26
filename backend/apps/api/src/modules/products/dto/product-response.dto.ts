import {
  Product,
  ProductStatus,
  ProductCategory,
  type ProductOptionGroup,
} from '@app/database';

export class ProductResponseDto {
  id!: string;
  storeId!: string;
  slug!: string;
  name!: string;
  description!: string | null;
  priceCents!: string; // BIGINT stays as string
  currency!: string;
  category!: ProductCategory;
  categoryId!: string | null;
  categoryName!: string | null;
  status!: ProductStatus;
  sku!: string | null;
  stockQuantity!: number | null;
  weightGrams!: number | null;
  imageKeys!: string[] | null;
  tags!: string[] | null;
  options!: ProductOptionGroup[] | null;
  sortOrder!: number;
  requiresShipping!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ProductListResponseDto {
  items!: ProductResponseDto[];
  total!: number;
}

export function toProductResponseDto(
  product: Product,
  categoryName: string | null = product.categoryRef?.name ?? null,
): ProductResponseDto {
  return {
    id: product.id,
    storeId: product.storeId,
    slug: product.slug,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    category: product.category,
    categoryId: product.categoryId ?? null,
    categoryName,
    status: product.status,
    sku: product.sku,
    stockQuantity: product.stockQuantity,
    weightGrams: product.weightGrams,
    imageKeys: product.imageKeys,
    tags: product.tags,
    options: product.options ?? null,
    sortOrder: product.sortOrder,
    requiresShipping: product.requiresShipping,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
