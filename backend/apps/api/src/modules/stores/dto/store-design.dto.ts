import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DesignCategoryLayout, DesignSettings } from '@app/database';

// Keep these lists in sync with frontend/src/lib/design.ts. They are the only
// keys the storefront knows how to render, so anything else is rejected at the
// API boundary instead of being saved and silently ignored later.
export const DESIGN_TEMPLATE_KEYS = [
  'atelier',
  'boutique',
  'bloom',
  'editorial',
  'studio',
  'noir',
  'bazaar',
  'table',
  'roast',
  'fresh',
  'arcade',
] as const;

export const DESIGN_PALETTE_KEYS = [
  'ivory',
  'sand',
  'blush',
  'sage',
  'ocean',
  'clay',
  'mono',
  'night',
] as const;

export const DESIGN_TYPOGRAPHY_KEYS = [
  'modern',
  'editorial',
  'warm',
  'display',
  'mono',
] as const;

export const DESIGN_SHAPE_KEYS = ['soft', 'round', 'pill', 'sharp'] as const;

export const DESIGN_DENSITY_KEYS = ['airy', 'balanced', 'compact'] as const;

export const DESIGN_HERO_KEYS = [
  'classic',
  'split',
  'poster',
  'minimal',
  'immersive',
] as const;

export const DESIGN_POST_LAYOUT_KEYS = [
  'grid',
  'masonry',
  'rail',
  'spotlight',
  'mosaic',
  'frames',
  'wall',
  'list',
  'stack',
  'cover',
] as const;

export const DESIGN_CATALOG_LAYOUT_KEYS = [
  'list',
  'cards',
  'compact',
  'menu',
  'gallery',
  'featured',
  'shelves',
] as const;

// Menu sections repeat one layout, a pair, or a triple. The studio keeps the
// UI to three simple choices: all sections same / 2 layouts / 3 layouts.
export const DESIGN_RHYTHM_KEYS = ['same', 'repeat2', 'repeat3'] as const;

export class DesignCategoryLayoutDto implements DesignCategoryLayout {
  @IsUUID()
  categoryId!: string;

  @IsIn(DESIGN_CATALOG_LAYOUT_KEYS)
  layout!: string;
}

export class StoreDesignSettingsDto implements DesignSettings {
  @IsOptional()
  @IsIn(DESIGN_TEMPLATE_KEYS)
  template?: string;

  @IsOptional()
  @IsIn(DESIGN_PALETTE_KEYS)
  palette?: string;

  @IsOptional()
  @IsIn(DESIGN_TYPOGRAPHY_KEYS)
  typography?: string;

  @IsOptional()
  @IsIn(DESIGN_SHAPE_KEYS)
  shape?: string;

  @IsOptional()
  @IsIn(DESIGN_DENSITY_KEYS)
  density?: string;

  @IsOptional()
  @IsIn(DESIGN_HERO_KEYS)
  hero?: string;

  @IsOptional()
  @IsIn(DESIGN_POST_LAYOUT_KEYS)
  postsLayout?: string;

  @IsOptional()
  @IsIn(DESIGN_CATALOG_LAYOUT_KEYS)
  catalogLayout?: string;

  // Second and third styles in the repeating rhythm.
  @IsOptional()
  @IsIn(DESIGN_CATALOG_LAYOUT_KEYS)
  accentLayout?: string;

  @IsOptional()
  @IsIn(DESIGN_CATALOG_LAYOUT_KEYS)
  thirdLayout?: string;

  @IsOptional()
  @IsIn(DESIGN_RHYTHM_KEYS)
  rhythm?: string;

  // Sparse per-section overrides. Bounded so one owner cannot store an
  // unbounded JSON document in the store row.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DesignCategoryLayoutDto)
  categoryLayouts?: DesignCategoryLayoutDto[];

  @IsOptional()
  @IsBoolean()
  showProductImages?: boolean;

  @IsOptional()
  @IsBoolean()
  showProductDescriptions?: boolean;
}
