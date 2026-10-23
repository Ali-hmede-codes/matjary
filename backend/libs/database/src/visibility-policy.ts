import { NotFoundException } from '@nestjs/common';
import { Raw, type EntityManager } from 'typeorm';
import { MediaAsset, Product, Showcase, Store } from './entities';

export type ContentKind = 'store' | 'product' | 'post' | 'media';

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
  return `${own} AND EXISTS (SELECT 1 FROM showcases vis_media_post WHERE vis_media_post.id = ${alias}.showcase_id AND ${post('vis_media_post')})`;
}

export function moderationWhere(kind: ContentKind) {
  return {
    adminArchivedAt: Raw((column) => {
      const alias = column.slice(0, column.lastIndexOf('.'));
      return `(${visibilitySql(kind, alias)})`;
    }),
  };
}

export async function assertContentAvailable(
  manager: EntityManager,
  kind: ContentKind,
  id: string,
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
    .andWhere(visibilitySql(kind, 'visible'))
    .getExists();
  if (!exists) throw new NotFoundException('Content not found');
}
