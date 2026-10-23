import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { AUTH_SCRIPT } from '../../apps/api/src/modules/auth/auth.page';
import { USER_DASHBOARD_SCRIPT } from '../../apps/api/src/modules/user-dashboard/user-dashboard.client';
import { UserDashboardService } from '../../apps/api/src/modules/user-dashboard/user-dashboard.service';

class Element {
  private text = '';
  children: Element[] = [];
  hidden = false;
  disabled = false;
  clientWidth = 350;
  href = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, () => unknown>();
  classList = { toggle: () => {} };
  get textContent(): string {
    return (
      this.text + this.children.map((child) => child.textContent).join(' ')
    );
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.text = '';
    this.children = children;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  querySelectorAll() {
    return this.children;
  }
  addEventListener(name: string, callback: () => unknown) {
    this.listeners.set(name, callback);
  }
}

function client(
  script: string,
  fetcher: (path: string, options: RequestInit) => Promise<Response>,
  hash = '',
) {
  const elements = new Map<string, Element>();
  const el = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const redirects: string[] = [];
  const events = new Map<string, () => unknown>();
  const location = { hash, replace: (path: string) => redirects.push(path) };
  let credentialReceived:
    ((result: { credential: string }) => Promise<void>) | undefined;
  new Script(script).runInNewContext({
    document: { getElementById: el, createElement: () => new Element() },
    location,
    window: {
      location,
      addEventListener: (name: string, callback: () => unknown) =>
        events.set(name, callback),
      google: {
        accounts: {
          id: {
            initialize: (options: { callback: typeof credentialReceived }) => {
              credentialReceived = options.callback;
            },
            renderButton: () => {},
          },
        },
      },
    },
    fetch: fetcher,
    AbortSignal,
  });
  return {
    el,
    redirects,
    events,
    location,
    signIn: () => credentialReceived?.({ credential: 'valid.token.signature' }),
  };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const user = { displayName: 'Shop owner', email: 'owner@example.test' };

test('fresh and returning Google accounts go to their own role-specific dashboard', async () => {
  for (const isAdmin of [false, true]) {
    for (const returning of [false, true]) {
      const browser = client(AUTH_SCRIPT, async (path) => {
        if (path.endsWith('/me') && !returning)
          return json({ message: 'Please sign in' }, 401);
        if (path.endsWith('/bootstrap'))
          return json({ clientId: 'test', nonce: 'test' });
        return json({ user, isAdmin });
      });
      await setImmediate();
      if (!returning) {
        assert.deepEqual(browser.redirects, []);
        await browser.signIn();
      }
      assert.deepEqual(browser.redirects, [
        isAdmin ? '/api/v1/admin' : '/api/v1/dashboard/home',
      ]);
    }
  }
});

test('personal dashboard renders own content, paginates, handles failures and signs out', async () => {
  const requests: string[] = [];
  let status = 200;
  let release: ((response: Response) => void) | undefined;
  const browser = client(
    USER_DASHBOARD_SCRIPT,
    async (path, options) => {
      requests.push(path);
      assert.equal(options.credentials, 'same-origin');
      if (path.endsWith('/auth/me')) return json({ user, isAdmin: false });
      if (path.endsWith('/auth/logout')) {
        assert.equal(options.method, 'POST');
        assert.equal(options.body, '{}');
        return new Response(null, { status: 204 });
      }
      if (path.includes('/posts')) {
        if (path.endsWith('offset=20'))
          return new Promise((resolve) => {
            release = resolve;
          });
        return json(
          {
            posts: [
              {
                title: '<img src=x onerror=alert(1)>',
                status: 'draft',
                storeSlug: null,
                viewsCount: 3,
                likesCount: 1,
              },
            ],
            total: 21,
          },
          status,
        );
      }
      if (path.endsWith('/stores')) return json([]);
      return json({
        subscription: null,
        limits: { maxTotalPosts: null, maxProducts: 0 },
      });
    },
    '#posts',
  );
  await setImmediate();
  assert.match(
    browser.el('content').textContent,
    /<img src=x onerror=alert\(1\)>/,
  );
  assert.equal(browser.el('page-label').textContent, 'Page 1 · 21 posts');
  assert.equal(browser.el('next').disabled, false);
  browser.el('next').listeners.get('click')?.();
  await setImmediate();
  assert.ok(requests.some((path) => path.endsWith('offset=20')));
  browser.location.hash = '#stores';
  browser.events.get('hashchange')?.();
  await setImmediate();
  release?.(json({ posts: [], total: 21 }));
  await setImmediate();
  assert.match(browser.el('content').textContent, /No stores yet/);
  assert.equal(browser.el('pagination').hidden, true);
  browser.location.hash = '#subscription';
  browser.events.get('hashchange')?.();
  await setImmediate();
  assert.match(browser.el('content').textContent, /Unlimited/);
  assert.match(browser.el('content').textContent, /Products 0/);
  status = 503;
  browser.location.hash = '#posts';
  browser.events.get('hashchange')?.();
  await setImmediate();
  assert.match(browser.el('status').textContent, /try Refresh/);
  assert.equal(browser.el('content').textContent, '');
  status = 200;
  await browser.el('refresh').listeners.get('click')?.();
  assert.equal(browser.el('status').textContent, '');
  await browser.el('logout').listeners.get('click')?.();
  assert.deepEqual(browser.redirects, ['/api/v1/auth/login']);
  assert.equal(browser.el('content').textContent, '');
  assert.equal(browser.el('account-email').textContent, '');
  assert.ok(requests.every((path) => !path.includes('/admin')));
  assert.doesNotMatch(
    USER_DASHBOARD_SCRIPT,
    /\.innerHTML\s*=|localStorage|eval\(/,
  );
});

test('personal dashboard redirects expired sessions and administrators without loading account data', async () => {
  for (const isAdmin of [false, true]) {
    const requests: string[] = [];
    const browser = client(USER_DASHBOARD_SCRIPT, async (path) => {
      requests.push(path);
      return json({ user, isAdmin }, isAdmin ? 200 : 401);
    });
    await setImmediate();
    assert.deepEqual(requests, ['/api/v1/auth/me']);
    assert.deepEqual(browser.redirects, [
      isAdmin ? '/api/v1/admin' : '/api/v1/auth/login',
    ]);
    assert.equal(browser.el('content').textContent, '');
  }
});

test('dashboard summary and lists scope every query to the owner and exclude moderated content', async () => {
  const ownerId = 'owner-1';
  const queries: { owner?: string; visibility?: string }[] = [];
  function repository(kind: 'post' | 'product') {
    return {
      count: async ({
        where,
      }: {
        where: {
          ownerId?: string;
          store?: { ownerId: string };
          adminArchivedAt?: unknown;
        };
      }) => {
        assert.equal(
          kind === 'post' ? where.ownerId : where.store?.ownerId,
          ownerId,
        );
        assert.ok(where.adminArchivedAt);
        return 0;
      },
      createQueryBuilder: () => {
        const query: (typeof queries)[number] = {};
        queries.push(query);
        const builder = {
          select: () => builder,
          addSelect: () => builder,
          innerJoin: () => builder,
          leftJoinAndSelect: () => builder,
          groupBy: () => builder,
          orderBy: () => builder,
          addOrderBy: () => builder,
          limit: () => builder,
          where: (sql: string, parameters: { userId: string }) => {
            assert.equal(
              sql,
              kind === 'post'
                ? 'sc.ownerId = :userId'
                : 'store.ownerId = :userId',
            );
            query.owner = parameters.userId;
            return builder;
          },
          andWhere: (sql: string) => {
            query.visibility = sql;
            return builder;
          },
          getRawMany: async () => [],
          getRawOne: async () => ({ totalMedia: 0 }),
          getMany: async () => [],
        };
        return builder;
      },
    };
  }
  const service = new UserDashboardService(
    {} as never,
    {
      find: async ({
        where,
      }: {
        where: { ownerId: string; adminArchivedAt?: unknown };
      }) => {
        assert.equal(where.ownerId, ownerId);
        assert.ok(where.adminArchivedAt);
        return [];
      },
    } as never,
    repository('post') as never,
    repository('product') as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getUserActiveSubscription: async (id: string) => {
        assert.equal(id, ownerId);
        return null;
      },
      getEffectiveLimits: async (id: string) => {
        assert.equal(id, ownerId);
        return { maxTotalPosts: 0 };
      },
    } as never,
  );
  const result = await service.getDashboard(ownerId);
  assert.equal(result.stats.totalStores, 0);
  assert.equal(result.stats.totalPosts, 0);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(result.products, []);
  assert.equal(queries.length, 5);
  for (const query of queries) {
    assert.equal(query.owner, ownerId);
    assert.match(query.visibility ?? '', /admin_archived_at IS NULL/);
    assert.match(query.visibility ?? '', /suspended_at IS NULL/);
  }
});
