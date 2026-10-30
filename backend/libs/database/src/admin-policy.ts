import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AdminAuditLog } from './admin.entities';
import { AdminScope, AdminStoreAssignment, User, UserRole } from './entities';

export function isAdminEmail(
  email: string | undefined,
  allowlist: string,
): boolean {
  return Boolean(
    email &&
    allowlist
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase()),
  );
}

// Configured administrators remain a protected bootstrap/recovery path.
export function isAdminUser(
  user: { email?: string; role?: UserRole } | undefined,
  allowlist: string,
): boolean {
  return Boolean(
    user &&
    (user.role === UserRole.ADMIN || isAdminEmail(user.email, allowlist)),
  );
}

// A platform administrator oversees every shop; a store-scoped administrator
// only reaches the shops assigned to them. Configured administrators always
// keep global reach so a bad assignment cannot lock the platform out.
export function isGlobalAdminUser(
  user:
    { email?: string; role?: UserRole; adminScope?: AdminScope } | undefined,
  allowlist: string,
): boolean {
  return Boolean(
    user &&
    isAdminUser(user, allowlist) &&
    (isAdminEmail(user.email, allowlist) ||
      (user.adminScope ?? AdminScope.ALL) === AdminScope.ALL),
  );
}

export interface AdminStoreScope {
  all: boolean;
  storeIds: string[];
}

// The rows are the source of truth for a scoped administrator; an empty list
// means they currently reach no shop, never that they reach all of them.
export async function adminStoreScope(
  manager: EntityManager,
  user: Pick<User, 'id' | 'adminScope'>,
): Promise<AdminStoreScope> {
  if ((user.adminScope ?? AdminScope.ALL) !== AdminScope.STORES)
    return { all: true, storeIds: [] };
  const rows = await manager.find(AdminStoreAssignment, {
    where: { userId: user.id },
    select: { storeId: true },
  });
  return {
    all: false,
    storeIds: [...new Set(rows.map((row) => row.storeId))].sort(),
  };
}

export interface AdminActor {
  id: string;
  requestId: string;
  reason?: string;
}

// Request context carries identity only, never cookies, tokens, or a mutable owner.
export const adminContext = new AsyncLocalStorage<AdminActor>();

export function actorContext(id: string): AdminActor {
  const context = adminContext.getStore();
  return context?.id === id ? context : { id, requestId: randomUUID() };
}

// Defaults to platform-wide access: every existing administrative operation
// stays global unless it explicitly opts into store-scoped access.
export async function requireAdmin(
  manager: EntityManager,
  actor: AdminActor,
  allowlist: string,
  options: { scope?: 'all' | 'any' } = {},
): Promise<User> {
  const user = await manager.findOneBy(User, { id: actor.id });
  if (!user || user.suspendedAt || !isAdminUser(user, allowlist)) {
    throw new ForbiddenException('Admin access required');
  }
  if (options.scope !== 'any' && !isGlobalAdminUser(user, allowlist))
    throw new ForbiddenException('Platform administrator access required');
  return user;
}

export async function appendAdminAudit(
  manager: EntityManager,
  actor: AdminActor,
  resource: string,
  resourceId: string,
  action: string,
  changedFields: string[] = [],
): Promise<void> {
  await manager.insert(AdminAuditLog, {
    id: randomUUID(),
    actorId: actor.id,
    requestId: actor.requestId,
    resource,
    resourceId,
    action,
    reason: actor.reason ?? null,
    changedFields: changedFields
      .filter((field) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field))
      .slice(0, 64),
  });
}
