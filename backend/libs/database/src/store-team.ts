import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Store, StoreInvitation, StoreMember } from './entities';
import { ownerWhere } from './visibility-policy';

export type StoreRole = 'owner' | 'member';

export interface StoreAccess {
  store: Store;
  // The account that owns the shop and its content. Content authored by a team
  // member is still created for this account, so plan quotas and public
  // visibility never depend on who happened to upload it.
  ownerId: string;
  role: StoreRole;
}

// A team member never widens the shop's lifecycle: a trashed or restricted shop
// is unreachable for members exactly like it is for its owner's panel.
export async function storeAccess(
  manager: EntityManager,
  userId: string,
  storeId: string,
): Promise<StoreAccess | null> {
  const store = await manager.findOneBy(Store, {
    id: storeId,
    ...ownerWhere('store'),
  });
  if (!store) return null;
  if (store.ownerId === userId)
    return { store, ownerId: store.ownerId, role: 'owner' };
  const member = await manager.findOneBy(StoreMember, { storeId, userId });
  return member ? { store, ownerId: store.ownerId, role: 'member' } : null;
}

export async function storeAccessBySlug(
  manager: EntityManager,
  userId: string,
  slug: string,
): Promise<StoreAccess | null> {
  const store = await manager.findOneBy(Store, {
    slug,
    ...ownerWhere('store'),
  });
  if (!store) return null;
  return storeAccess(manager, userId, store.id);
}

// Every content path returns the same "not found" answer so a member cannot
// probe which shops exist outside their access.
export async function assertStoreAccess(
  manager: EntityManager,
  userId: string,
  storeId: string,
): Promise<StoreAccess> {
  const access = await storeAccess(manager, userId, storeId);
  if (!access) throw new NotFoundException('Store not found');
  return access;
}

// Used where only the store row is already loaded (storefront controls).
export async function canManageStore(
  manager: EntityManager,
  userId: string,
  store: Pick<Store, 'id' | 'ownerId'>,
): Promise<boolean> {
  if (store.ownerId === userId) return true;
  return manager.exists(StoreMember, {
    where: { storeId: store.id, userId },
  });
}

// Pending invitations are short-lived; an expired row is treated as absent.
export function invitationIsLive(
  invitation: Pick<StoreInvitation, 'expiresAt'>,
  now = new Date(),
): boolean {
  return invitation.expiresAt > now;
}
