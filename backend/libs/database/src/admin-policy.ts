import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AdminAuditLog } from './admin.entities';
import { User, UserRole } from './entities';

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

export async function requireAdmin(
  manager: EntityManager,
  actor: AdminActor,
  allowlist: string,
): Promise<User> {
  const user = await manager.findOneBy(User, { id: actor.id });
  if (!user || user.suspendedAt || !isAdminUser(user, allowlist)) {
    throw new ForbiddenException('Admin access required');
  }
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
