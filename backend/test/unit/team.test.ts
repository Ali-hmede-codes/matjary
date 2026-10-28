import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  Store,
  StoreInvitation,
  StoreMember,
  StoreStatus,
  User,
  invitationIsLive,
} from '@app/database';
import {
  assertStoreAccess,
  storeAccess,
} from '../../libs/database/src/store-team';
import {
  TeamService,
  normalizeTeamEmail,
} from '../../apps/api/src/modules/team/team.service';

const owner = Object.assign(new User(), {
  id: 'owner-1',
  email: 'owner@gmail.com',
  displayName: 'Amina',
});
const store = Object.assign(new Store(), {
  id: 'store-1',
  slug: 'cedar-shop',
  name: 'Cedar Shop',
  ownerId: owner.id,
  status: StoreStatus.ACTIVE,
  adminArchivedAt: null,
});
const helper = Object.assign(new User(), {
  id: 'helper-1',
  email: 'helper@gmail.com',
  displayName: 'Yara',
});

function teamFixture() {
  const members: StoreMember[] = [];
  const invitations: StoreInvitation[] = [];
  const accounts = [owner, helper];
  let sequence = 0;

  const manager = {
    async transaction<T>(work: (m: EntityManager) => Promise<T>) {
      return work(manager as unknown as EntityManager);
    },
    async findOne(
      target: unknown,
      options: { where: Record<string, unknown> },
    ) {
      const where = options.where;
      if (target === Store) {
        if (where.id && where.id !== store.id) return null;
        if (where.slug && where.slug !== store.slug) return null;
        if (where.ownerId && where.ownerId !== store.ownerId) return null;
        return Object.assign(new Store(), store);
      }
      if (target === User)
        return (
          accounts.find(
            (account) =>
              account.email === where.email || account.id === where.id,
          ) ?? null
        );
      if (target === StoreInvitation)
        return (
          invitations.find((invitation) => invitation.id === where.id) ?? null
        );
      return null;
    },
    async findOneBy(target: unknown, where: Record<string, unknown>) {
      if (target === Store) return Object.assign(new Store(), store);
      if (target === StoreMember)
        return (
          members.find(
            (member) =>
              member.storeId === where.storeId &&
              (!where.userId || member.userId === where.userId) &&
              (!where.id || member.id === where.id),
          ) ?? null
        );
      if (target === StoreInvitation)
        return (
          invitations.find(
            (invitation) =>
              invitation.id === where.id ||
              invitation.storeId === where.storeId,
          ) ?? null
        );
      return null;
    },
    async find(target: unknown, options: { where: Record<string, unknown> }) {
      if (target === StoreInvitation && options.where.storeId === store.id)
        return [...invitations];
      return [];
    },
    async countBy(target: unknown, where: Record<string, unknown>) {
      return target === StoreMember
        ? members.filter((member) => member.storeId === where.storeId).length
        : 0;
    },
    create(target: unknown, value: object) {
      const Entity = target as new () => object;
      return Object.assign(new Entity(), value);
    },
    async save(value: unknown) {
      const record = value as { id?: string; createdAt?: Date };
      if (value instanceof StoreMember) {
        record.id ??= `member-${++sequence}`;
        record.createdAt ??= new Date();
        members.push(value);
      } else if (value instanceof StoreInvitation) {
        record.id ??= `invitation-${++sequence}`;
        record.createdAt ??= new Date();
        invitations.push(value);
      }
      return value;
    },
    async remove(value: unknown) {
      const index = invitations.indexOf(value as StoreInvitation);
      if (index >= 0) invitations.splice(index, 1);
    },
  };

  const service = new TeamService(
    { manager } as never,
    { manager, find: async () => [] } as never,
    { manager, find: async () => [] } as never,
  );
  return { service, members, invitations, manager };
}

test('team emails are normalized and invitations expire', () => {
  assert.equal(normalizeTeamEmail('  Yara@Gmail.com '), 'yara@gmail.com');
  assert.equal(
    invitationIsLive({ expiresAt: new Date(Date.now() + 60_000) }),
    true,
  );
  assert.equal(
    invitationIsLive({ expiresAt: new Date(Date.now() - 60_000) }),
    false,
  );
});

test('store access allows the owner and invited members only', async () => {
  const f = teamFixture();
  assert.deepEqual(await storeAccess(f.manager as never, owner.id, store.id), {
    store,
    ownerId: owner.id,
    role: 'owner',
  });
  assert.equal(
    await storeAccess(f.manager as never, helper.id, store.id),
    null,
  );
  f.members.push(
    Object.assign(new StoreMember(), {
      id: 'member-1',
      storeId: store.id,
      userId: helper.id,
    }),
  );
  const access = await storeAccess(f.manager as never, helper.id, store.id);
  assert.equal(access?.role, 'member');
  assert.equal(access?.ownerId, owner.id);
  await assert.rejects(
    assertStoreAccess(f.manager as never, 'stranger', store.id),
    NotFoundException,
  );
});

test('adding an existing account grants access without an invitation', async () => {
  const f = teamFixture();
  const result = await f.service.invite('cedar-shop', ' HELPER@Gmail.com ', {
    id: owner.id,
    email: owner.email,
  });
  assert.equal(result.status, 'added');
  assert.equal(result.member?.displayName, helper.displayName);
  assert.equal(f.members.length, 1);
  assert.equal(f.members[0]?.userId, helper.id);
  assert.equal(f.invitations.length, 0);
});

test('a new Gmail address receives a pending invitation', async () => {
  const f = teamFixture();
  const result = await f.service.invite('cedar-shop', 'New@gmail.com', {
    id: owner.id,
    email: owner.email,
  });
  assert.equal(result.status, 'invited');
  assert.equal(f.invitations.length, 1);
  assert.equal(f.invitations[0]?.email, 'new@gmail.com');
  assert.ok(invitationIsLive(f.invitations[0]!));
  assert.equal(f.members.length, 0);
});

test('owners cannot invite themselves and accepting is bound to the Gmail address', async () => {
  const f = teamFixture();
  await assert.rejects(
    f.service.invite('cedar-shop', owner.email, {
      id: owner.id,
      email: owner.email,
    }),
    ConflictException,
  );

  const invitation = Object.assign(new StoreInvitation(), {
    id: 'invitation-1',
    storeId: store.id,
    email: 'new@gmail.com',
    invitedById: owner.id,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  });
  f.invitations.push(invitation);
  await assert.rejects(
    f.service.accept(invitation.id, {
      id: helper.id,
      email: helper.email,
    }),
    NotFoundException,
  );

  const accepted = await f.service.accept(invitation.id, {
    id: 'new-account',
    email: 'NEW@gmail.com',
  });
  assert.equal(accepted.store.slug, store.slug);
  assert.ok(f.members.some((member) => member.userId === 'new-account'));
  assert.equal(f.invitations.length, 0);
});

test('a member can leave without touching the owner account', async () => {
  const f = teamFixture();
  f.members.push(
    Object.assign(new StoreMember(), {
      id: 'member-1',
      storeId: store.id,
      userId: helper.id,
    }),
  );
  const service = new TeamService(
    { manager: f.manager } as never,
    {
      manager: f.manager,
      findOneBy: async (where: { storeId: string; userId: string }) =>
        f.members.find(
          (member) =>
            member.storeId === where.storeId && member.userId === where.userId,
        ) ?? null,
      remove: async (member: StoreMember) => {
        f.members.splice(f.members.indexOf(member), 1);
      },
    } as never,
    { manager: f.manager } as never,
  );
  await service.leave(store.id, helper.id);
  assert.equal(f.members.length, 0);
});
