import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { MediaKind } from '@app/database';

const storeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// A story carries no title or description: one processed media file, an
// optional single link to the shop's own product or section, and a 24-hour life.
export const STORE_SLUG_PATTERN = storeSlugPattern;
export class CreateStoryDto {
  @IsString()
  @Length(1, 191)
  @Matches(storeSlugPattern)
  storeSlug!: string;

  @IsUUID('4')
  mediaId!: string;

  @IsOptional()
  @IsUUID('4')
  linkedProductId?: string;

  @IsOptional()
  @IsUUID('4')
  linkedCategoryId?: string;
}

export interface StoryLinkDto {
  type: 'product' | 'category';
  name: string;
  // Products are addressed by slug; sections by their derived label slug.
  slug: string | null;
  priceCents: string | null;
  currency: string | null;
  // Old price while the linked item is on sale.
  compareAtPriceCents: string | null;
}

export interface StoryMediaDto {
  id: string;
  kind: MediaKind;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  primaryUrl: string;
  posterUrl: string | null;
}

export interface StoryDto {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  media: StoryMediaDto;
  link?: StoryLinkDto;
}

export interface StoryStoreDto {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  brandColor: string | null;
  hasVerificationBadge: boolean;
  verificationBadgeExpiresAt: Date | null;
  businessCategoryLabel: string;
}

export interface StoryGroupDto {
  store: StoryStoreDto;
  stories: StoryDto[];
}

export interface StoryListResponse {
  groups: StoryGroupDto[];
  total: number;
}

export interface MyStoriesResponse {
  storeId: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  stories: StoryDto[];
}
