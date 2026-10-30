import { NotFoundException } from '@nestjs/common';
import { Raw, type EntityManager } from 'typeorm';
import {
  MediaAsset,
  MediaStatus,
  Product,
  ProductStatus,
  Showcase,
  Store,
} from './entities';

export type ContentKind = 'store' | 'product' | 'post' | 'media';

// Out of stock is still a published item: shoppers must see that it exists (and
// that it cannot be bought), so every public product query shares this pair.
// Drafts and archived items remain private. Purchasing stays ACTIVE-only.
export const PUBLIC_PRODUCT_STATUSES: readonly ProductStatus[] = [
  ProductStatus.ACTIVE,
  ProductStatus.OUT_OF_STOCK,
];

export function isPublicProductStatus(status: ProductStatus): boolean {
  return (
    status === ProductStatus.ACTIVE || status === ProductStatus.OUT_OF_STOCK
  );
}

// Aliases are code-owned. No caller-supplied values are interpolated into SQL.
export function visibilitySql(kind: ContentKind, alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))
    throw new Error('Invalid query alias');
  const own = `${alias}.admin_archived_at IS NULL`;
  if (kind === 'store')
    return `${own} AND EXISTS (SELECT 1 FROM users vis_store_owner WHERE vis_store_owner.id = ${alias}.owner_id AND vis_store_owner.suspended_at IS NULL)`;
  if (kind === 'product')
    return `${own} AND EXISTS (SELECT 1 FROM stores vis_product_store JOIN users vis_product_owner ON vis_product_owner.id = vis_product_store.owner_id WHERE vis_product_store.id = ${alias}.store_id AND vis_product_store.admin_archived_at IS NULL AND vis_product_owner.suspended_at IS NULL)`;
  const post = (a: string) =>
    `${a}.admin_archived_at IS NULL AND EXISTS (SELECT 1 FROM users vis_post_owner WHERE vis_post_owner.id = ${a}.owner_id AND vis_post_owner.suspended_at IS NULL) AND (${a}.store_id IS NULL OR EXISTS (SELECT 1 FROM stores vis_post_store JOIN users vis_parent_owner ON vis_parent_owner.id = vis_post_store.owner_id WHERE vis_post_store.id = ${a}.store_id AND vis_post_store.admin_archived_at IS NULL AND vis_parent_owner.suspended_at IS NULL))`;
  if (kind === 'post') return post(alias);
  return `${own} AND (
    EXISTS (SELECT 1 FROM showcases vis_media_post WHERE vis_media_post.id = ${alias}.showcase_id AND ${post('vis_media_post')}) OR
    EXISTS (SELECT 1 FROM stores vis_media_store WHERE vis_media_store.id = ${alias}.store_id AND ${visibilitySql('store', 'vis_media_store')}) OR
    EXISTS (SELECT 1 FROM products vis_media_product WHERE vis_media_product.id = ${alias}.product_id AND ${visibilitySql('product', 'vis_media_product')})
  )`;
}

export function moderationWhere(kind: ContentKind) {
  return {
    adminArchivedAt: Raw((column) => {
      const alias = column.slice(0, column.lastIndexOf('.'));
      return `(${visibilitySql(kind, alias)})`;
    }),
  };
}

// Owner management is separate from public publication. Off/archived content stays editable.
function lifecycleSql(
  kind: ContentKind,
  alias: string,
  publicOnly: boolean,
): string {
  const state = (store: string) =>
    `${store}.status ${publicOnly ? "= 'active'" : "!= 'trashed'"}`;
  if (kind === 'store') return state(alias);
  if (kind === 'product')
    return `EXISTS (SELECT 1 FROM stores life_product_store WHERE life_product_store.id = ${alias}.store_id AND ${state('life_product_store')})`;
  if (kind === 'post')
    return `(${alias}.store_id IS NULL OR EXISTS (SELECT 1 FROM stores life_post_store WHERE life_post_store.id = ${alias}.store_id AND ${state('life_post_store')}))`;
  return `(EXISTS (SELECT 1 FROM showcases life_post WHERE life_post.id = ${alias}.showcase_id AND ${lifecycleSql('post', 'life_post', publicOnly)}) OR EXISTS (SELECT 1 FROM stores life_store WHERE life_store.id = ${alias}.store_id AND ${state('life_store')}) OR EXISTS (SELECT 1 FROM products life_product WHERE life_product.id = ${alias}.product_id AND ${lifecycleSql('product', 'life_product', publicOnly)}))`;
}

export function publicVisibilitySql(kind: ContentKind, alias: string): string {
  const base = `(${visibilitySql(kind, alias)}) AND (${lifecycleSql(kind, alias, true)})`;
  return kind === 'post'
    ? `${base} AND ${publicPostMediaReadinessSql(alias)}`
    : base;
}

// A post may be published while its photos or video are still uploading or
// encoding. Until the first processed variant commits READY, a public card
// would have no picture to show, so public listings and shared links skip the
// post; it appears automatically when the worker finishes. Owner queries use
// ownerVisibilitySql and still see it meanwhile. A post that already has a
// READY asset keeps its place while additional media is processed.
function publicPostMediaReadinessSql(alias: string): string {
  return `((NOT EXISTS (SELECT 1 FROM media_assets public_in_flight_media WHERE public_in_flight_media.showcase_id = ${alias}.id AND public_in_flight_media.status IN ('${MediaStatus.PENDING}', '${MediaStatus.PROCESSING}'))) OR EXISTS (SELECT 1 FROM media_assets public_ready_media WHERE public_ready_media.showcase_id = ${alias}.id AND public_ready_media.status = '${MediaStatus.READY}'))`;
}

export function ownerVisibilitySql(kind: ContentKind, alias: string): string {
  return `(${visibilitySql(kind, alias)}) AND (${lifecycleSql(kind, alias, false)})`;
}

function scopedWhere(kind: ContentKind, publicOnly: boolean) {
  return {
    adminArchivedAt: Raw((column) => {
      const alias = column.slice(0, column.lastIndexOf('.'));
      return `(${publicOnly ? publicVisibilitySql(kind, alias) : ownerVisibilitySql(kind, alias)})`;
    }),
  };
}
export const publicWhere = (kind: ContentKind) => scopedWhere(kind, true);
export const ownerWhere = (kind: ContentKind) => scopedWhere(kind, false);

export async function assertContentAvailable(
  manager: EntityManager,
  kind: ContentKind,
  id: string,
  scope: 'moderation' | 'public' | 'owner' = 'moderation',
): Promise<void> {
  const target = {
    store: Store,
    product: Product,
    post: Showcase,
    media: MediaAsset,
  }[kind];
  const exists = await manager
    .getRepository(target)
    .createQueryBuilder('visible')
    .where('visible.id = :visibilityId', { visibilityId: id })
    .andWhere(
      scope === 'public'
        ? publicVisibilitySql(kind, 'visible')
        : scope === 'owner'
          ? ownerVisibilitySql(kind, 'visible')
          : visibilitySql(kind, 'visible'),
    )
    .getExists();
  if (!exists) throw new NotFoundException('Content not found');
}
