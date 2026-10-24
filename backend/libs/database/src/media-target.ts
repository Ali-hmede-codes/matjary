import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  MediaAsset,
  MediaVariant,
  MediaStatus,
  Product,
  Store,
  Showcase,
} from './entities';
import { ownerWhere } from './visibility-policy';

export async function mediaParent(
  manager: EntityManager,
  asset: Pick<MediaAsset, 'showcaseId' | 'storeId' | 'productId'>,
  moderated = true,
) {
  if (asset.showcaseId) {
    const post = await manager.findOneBy(Showcase, {
      id: asset.showcaseId,
      ...(moderated ? ownerWhere('post') : {}),
    });
    if (!post) throw new NotFoundException('Media parent not found');
    const store = post.storeId
      ? await manager.findOneBy(Store, {
          id: post.storeId,
          ...(moderated ? ownerWhere('store') : {}),
        })
      : null;
    if (post.storeId && !store)
      throw new NotFoundException('Media parent not found');
    return { ownerId: post.ownerId, post, store, product: null };
  }
  if (asset.productId) {
    const product = await manager.findOneBy(Product, {
      id: asset.productId,
      ...(moderated ? ownerWhere('product') : {}),
    });
    if (!product) throw new NotFoundException('Media parent not found');
    const store = await manager.findOneBy(Store, {
      id: product.storeId,
      ...(moderated ? ownerWhere('store') : {}),
    });
    if (!store) throw new NotFoundException('Media parent not found');
    return { ownerId: store.ownerId, post: null, store, product };
  }
  if (asset.storeId) {
    const store = await manager.findOneBy(Store, {
      id: asset.storeId,
      ...(moderated ? ownerWhere('store') : {}),
    });
    if (store)
      return { ownerId: store.ownerId, post: null, store, product: null };
  }
  throw new NotFoundException('Media parent not found');
}

export async function assertMediaAttachment(
  manager: EntityManager,
  ownerId: string,
  purpose: MediaAsset['purpose'],
  parentId: string,
  keys: Array<string | null | undefined>,
  retained: Array<string | null | undefined> = [],
): Promise<void> {
  for (const key of keys) {
    if (!key) continue;
    const variant = await manager.findOne(MediaVariant, {
      where: { storageKey: key, asset: ownerWhere('media') },
      relations: ['asset'],
    });
    if (
      !variant ||
      variant.asset.status !== MediaStatus.READY ||
      variant.asset.kind !== 'image'
    )
      throw new ConflictException('Choose a processed image from this item');
    const asset = variant.asset;
    const parent = await mediaParent(manager, asset);
    // Existing post-backed branding remains usable, but cannot be copied onto other items.
    const legacy = asset.showcaseId && retained.includes(key);
    if (
      parent.ownerId !== ownerId ||
      (!legacy &&
        (asset.purpose !== purpose ||
          (purpose === 'product_image' ? asset.productId : asset.storeId) !==
            parentId))
    )
      throw new ConflictException('Choose a processed image from this item');
  }
}

// Static aliases only; reused for storage accounting and administrative owner filters.
export const MEDIA_OWNER_JOINS = `LEFT JOIN showcases media_post ON media_post.id = a.showcase_id
  LEFT JOIN products media_product ON media_product.id = a.product_id
  LEFT JOIN stores media_store ON media_store.id = COALESCE(a.store_id, media_product.store_id)`;
export const MEDIA_OWNER_ID =
  'COALESCE(media_post.owner_id, media_store.owner_id)';
