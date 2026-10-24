import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Product, Showcase, Store, User } from './entities';
import { ownerWhere } from './visibility-policy';

type OwnedEntities = { store: Store; product: Product; post: Showcase };

// All lifecycle and owner writes take the account lock first. Checking only before
// async validation/geocoding would allow a stale form to write after a move to Trash.
export async function lockOwnerContent<K extends keyof OwnedEntities>(
  manager: EntityManager,
  kind: K,
  id: string,
  ownerId: string,
): Promise<OwnedEntities[K]> {
  const owner = await manager.findOne(User, {
    where: { id: ownerId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!owner || owner.suspendedAt)
    throw new NotFoundException('Content not found');
  if (kind === 'store') {
    const store = await manager.findOne(Store, {
      where: { id, ownerId, ...ownerWhere('store') },
      lock: { mode: 'pessimistic_write' },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store as OwnedEntities[K];
  }
  if (kind === 'product') {
    const product = await manager.findOne(Product, {
      where: { id, store: { ownerId }, ...ownerWhere('product') },
      lock: { mode: 'pessimistic_write' },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product as OwnedEntities[K];
  }
  const post = await manager.findOne(Showcase, {
    where: { id, ownerId, ...ownerWhere('post') },
    lock: { mode: 'pessimistic_write' },
  });
  if (!post) throw new NotFoundException('Post not found');
  return post as OwnedEntities[K];
}
