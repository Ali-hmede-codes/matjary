import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import {
  Showcase,
  ShowcaseStatus,
  Store,
} from '../../libs/database/src/entities';
import { ShowcasesService } from '../../apps/api/src/modules/showcases/showcases.service';
import { ShowcasesController } from '../../apps/api/src/modules/showcases/showcases.controller';
import { CreateShowcaseDto } from '../../apps/api/src/modules/showcases/dto/create-showcase.dto';
import { UpdateShowcaseDto } from '../../apps/api/src/modules/showcases/dto/update-showcase.dto';

function makeShowcase(overrides: Partial<Showcase> = {}): Showcase {
  return {
    id: 'showcase-1',
    slug: 'my-post',
    title: 'My Post',
    description: 'A post',
    status: ShowcaseStatus.PUBLISHED,
    publishedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ownerId: 'owner-1',
    ...overrides,
  } as Showcase;
}

class FakeRepository {
  items: Showcase[] = [];

  async findOneBy(where: Record<string, unknown>): Promise<Showcase | null> {
    const key = Object.keys(where)[0]!;
    const value = where[key];
    return (
      this.items.find((item) => item[key as keyof Showcase] === value) ?? null
    );
  }

  async findAndCount(options: any): Promise<[Showcase[], number]> {
    let filtered = this.items;
    if (options.where) {
      const key = Object.keys(options.where)[0]!;
      const value = options.where[key];
      filtered = filtered.filter(
        (item) => item[key as keyof Showcase] === value,
      );
    }
    const take = options.take ?? filtered.length;
    const skip = Math.max(options.skip ?? 0, 0);
    const page = filtered.slice(skip, skip + take);
    return [page, filtered.length];
  }

  create(value: any): any {
    return value;
  }

  async save(value: any): Promise<any> {
    return { ...value, id: value.id || 'showcase-new' };
  }

  async remove(value: any): Promise<void> {
    // no-op
  }
}

function serviceWith(fake: FakeRepository): ShowcasesService {
  const seoService = {
    autoGenerateShowcaseSeo: async () => {},
    notifyIndexNowOnChange: async () => {},
  } as any;
  return new ShowcasesService(
    fake as unknown as Repository<Showcase>,
    fake as unknown as Repository<Store>,
    seoService,
  );
}

function controllerWith(service: ShowcasesService): ShowcasesController {
  return new ShowcasesController(service);
}

// ── Service: create ──

test('service.create sets ownerId and defaults status to draft', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  const dto: CreateShowcaseDto = {
    slug: 'hello-world',
    title: 'Hello World',
    description: 'First post',
  };
  const result = await svc.create(dto, 'user-1');
  assert.equal(result.ownerId, 'user-1');
  assert.equal(result.status, ShowcaseStatus.DRAFT);
  assert.equal(result.slug, 'hello-world');
  assert.equal(result.title, 'Hello World');
  assert.equal(fake.items.length, 0); // create() doesn't push to fake.items
});

test('service.create rejects duplicate slug with sanitized ConflictException', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ slug: 'existing' }));
  const svc = serviceWith(fake);
  const dto: CreateShowcaseDto = {
    slug: 'existing',
    title: 'Duplicate',
  };
  await assert.rejects(
    svc.create(dto, 'user-1'),
    (error: Error) =>
      error instanceof ConflictException &&
      error.message === 'A post with this slug already exists',
  );
});

test('service.create sanitizes database failures without leaking details', async () => {
  const fake = new FakeRepository();
  fake.save = async () => {
    throw new Error('private database host');
  };
  const svc = serviceWith(fake);
  const dto: CreateShowcaseDto = {
    slug: 'hello-world',
    title: 'Hello World',
  };
  await assert.rejects(
    svc.create(dto, 'user-1'),
    (error: Error) =>
      error instanceof ServiceUnavailableException &&
      error.message === 'Post storage is temporarily unavailable',
  );
});

test('service.create sets publishedAt when status is published', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  const dto: CreateShowcaseDto = {
    slug: 'published-post',
    title: 'Published',
    status: ShowcaseStatus.PUBLISHED,
  };
  const result = await svc.create(dto, 'user-1');
  assert.equal(result.status, ShowcaseStatus.PUBLISHED);
  assert.ok(result.publishedAt);
});

// ── Service: findAll ──

test('service.findAll public returns only published posts', async () => {
  const fake = new FakeRepository();
  fake.items.push(
    makeShowcase({ slug: 'published-1', status: ShowcaseStatus.PUBLISHED }),
    makeShowcase({ slug: 'draft-1', status: ShowcaseStatus.DRAFT }),
    makeShowcase({ slug: 'published-2', status: ShowcaseStatus.PUBLISHED }),
  );
  const svc = serviceWith(fake);
  const result = await svc.findAll(undefined, 20, 0);
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 2);
  assert.ok(
    result.items.every((item) => item.status === ShowcaseStatus.PUBLISHED),
  );
});

test('service.findAll owner returns all posts including drafts', async () => {
  const fake = new FakeRepository();
  fake.items.push(
    makeShowcase({
      slug: 'draft-1',
      status: ShowcaseStatus.DRAFT,
      ownerId: 'user-1',
    }),
    makeShowcase({
      slug: 'published-1',
      status: ShowcaseStatus.PUBLISHED,
      ownerId: 'user-1',
    }),
    makeShowcase({
      slug: 'other-1',
      status: ShowcaseStatus.PUBLISHED,
      ownerId: 'user-2',
    }),
  );
  const svc = serviceWith(fake);
  const result = await svc.findAll('user-1', 20, 0);
  assert.equal(result.total, 2);
  assert.ok(result.items.every((item) => item.ownerId === 'user-1'));
});

test('service.findAll paginates with limit and offset', async () => {
  const fake = new FakeRepository();
  for (let i = 0; i < 5; i++) {
    fake.items.push(
      makeShowcase({
        slug: `post-${i}`,
        status: ShowcaseStatus.PUBLISHED,
      }),
    );
  }
  const svc = serviceWith(fake);
  const first = await svc.findAll(undefined, 2, 0);
  assert.equal(first.total, 5);
  assert.equal(first.items.length, 2);
  const second = await svc.findAll(undefined, 2, 2);
  assert.equal(second.items.length, 2);
  const third = await svc.findAll(undefined, 2, 4);
  assert.equal(third.items.length, 1);
});

// ── Service: findOneBySlug ──

test('service.findOneBySlug returns published post to public viewer', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ slug: 'my-post' }));
  const svc = serviceWith(fake);
  const result = await svc.findOneBySlug('my-post', undefined);
  assert.equal(result.slug, 'my-post');
  assert.equal(result.status, ShowcaseStatus.PUBLISHED);
});

test('service.findOneBySlug hides draft from non-owner with generic message', async () => {
  const fake = new FakeRepository();
  fake.items.push(
    makeShowcase({ slug: 'draft-post', status: ShowcaseStatus.DRAFT }),
  );
  const svc = serviceWith(fake);
  await assert.rejects(
    svc.findOneBySlug('draft-post', 'other-user'),
    NotFoundException,
  );
});

test('service.findOneBySlug lets owner see their own draft', async () => {
  const fake = new FakeRepository();
  fake.items.push(
    makeShowcase({
      slug: 'draft-post',
      status: ShowcaseStatus.DRAFT,
      ownerId: 'user-1',
    }),
  );
  const svc = serviceWith(fake);
  const result = await svc.findOneBySlug('draft-post', 'user-1');
  assert.equal(result.slug, 'draft-post');
  assert.equal(result.status, ShowcaseStatus.DRAFT);
});

test('service.findOneBySlug throws NotFoundException for missing post', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  await assert.rejects(
    svc.findOneBySlug('missing', undefined),
    NotFoundException,
  );
});

// ── Service: update ──

test('service.update lets owner update title and status', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  const svc = serviceWith(fake);
  const dto: UpdateShowcaseDto = {
    title: 'Updated Title',
    status: ShowcaseStatus.ARCHIVED,
  };
  const result = await svc.update('my-post', dto, 'user-1');
  assert.equal(result.title, 'Updated Title');
  assert.equal(result.status, ShowcaseStatus.ARCHIVED);
});

test('service.update sets publishedAt when status changes to published', async () => {
  const fake = new FakeRepository();
  fake.items.push(
    makeShowcase({
      slug: 'my-post',
      status: ShowcaseStatus.DRAFT,
      ownerId: 'user-1',
    }),
  );
  const svc = serviceWith(fake);
  const dto: UpdateShowcaseDto = { status: ShowcaseStatus.PUBLISHED };
  const result = await svc.update('my-post', dto, 'user-1');
  assert.equal(result.status, ShowcaseStatus.PUBLISHED);
  assert.ok(result.publishedAt);
});

test('service.update rejects non-owner with ForbiddenException', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  const svc = serviceWith(fake);
  const dto: UpdateShowcaseDto = { title: 'Hacked' };
  await assert.rejects(
    svc.update('my-post', dto, 'user-2'),
    ForbiddenException,
  );
});

test('service.update throws NotFoundException for missing post', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  const dto: UpdateShowcaseDto = { title: 'Nope' };
  await assert.rejects(svc.update('missing', dto, 'user-1'), NotFoundException);
});

// ── Service: remove ──

test('service.remove lets owner delete their post', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  let removed = false;
  fake.remove = async () => {
    removed = true;
  };
  const svc = serviceWith(fake);
  await svc.remove('my-post', 'user-1');
  assert.equal(removed, true);
});

test('service.remove rejects non-owner with ForbiddenException', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  const svc = serviceWith(fake);
  await assert.rejects(svc.remove('my-post', 'user-2'), ForbiddenException);
});

test('service.remove throws NotFoundException for missing post', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  await assert.rejects(svc.remove('missing', 'user-1'), NotFoundException);
});

// ── Controller ──

test('controller.list calls service with no owner filter for public access', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ status: ShowcaseStatus.PUBLISHED }));
  const svc = serviceWith(fake);
  const ctrl = controllerWith(svc);
  const result = await ctrl.list(20, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 1);
});

test('controller.getOne calls service with undefined userId for public access', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ slug: 'my-post' }));
  const svc = serviceWith(fake);
  const ctrl = controllerWith(svc);
  const result = await ctrl.getOne('my-post');
  assert.equal(result.slug, 'my-post');
});

test('controller.create passes ownerId from request user', async () => {
  const fake = new FakeRepository();
  const svc = serviceWith(fake);
  const ctrl = controllerWith(svc);
  const dto: CreateShowcaseDto = {
    slug: 'new-post',
    title: 'New Post',
  };
  const result = await ctrl.create(dto, { user: { id: 'user-1' } } as any);
  assert.equal(result.ownerId, 'user-1');
});

test('controller.update passes userId to service', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  const svc = serviceWith(fake);
  const ctrl = controllerWith(svc);
  const dto: UpdateShowcaseDto = { title: 'Updated' };
  const result = await ctrl.update('my-post', dto, {
    user: { id: 'user-1' },
  } as any);
  assert.equal(result.title, 'Updated');
});

test('controller.remove passes userId to service', async () => {
  const fake = new FakeRepository();
  fake.items.push(makeShowcase({ ownerId: 'user-1' }));
  let removed = false;
  fake.remove = async () => {
    removed = true;
  };
  const svc = serviceWith(fake);
  const ctrl = controllerWith(svc);
  await ctrl.remove('my-post', { user: { id: 'user-1' } } as any);
  assert.equal(removed, true);
});
