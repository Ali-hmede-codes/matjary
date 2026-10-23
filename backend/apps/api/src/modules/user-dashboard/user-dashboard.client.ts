export const USER_DASHBOARD_SCRIPT = String.raw`'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const views = new Map([
    ['overview', ['Overview', 'A snapshot of your own stores and content.']],
    ['stores', ['My stores', 'Your storefronts, all in one place.']],
    ['posts', ['My posts', 'Your drafts, published stories, and engagement.']],
    ['products', ['My products', 'Your catalog, prices, and availability.']],
    ['subscription', ['My subscription', 'Your current plan and account limits.']],
  ]);
  const pageSize = 20;
  let offset = 0;
  let generation = 0;
  let ready = false;
  let signingOut = false;
  const currentView = () => views.has(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function link(text, href) {
    const element = node('a', text);
    element.href = href;
    return element;
  }
  function message(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }
  function clearAccount() {
    generation++;
    ready = false;
    $('content').replaceChildren();
    $('pagination').hidden = true;
    $('account-name').textContent = 'Your account';
    $('account-email').textContent = '';
    $('avatar').textContent = 'm';
    $('welcome-title').textContent = 'My dashboard';
  }
  async function api(path, body) {
    const response = await fetch('/api/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) {
      clearAccount();
      message('Your session has expired. Redirecting to sign-in…');
      window.location.replace('/api/v1/auth/login');
      throw new Error('Please sign in again.');
    }
    if (!response.ok) throw new Error('Your dashboard is temporarily unavailable. Please try again.');
    return response.status === 204 ? null : response.json();
  }
  function failure() {
    message('Your dashboard could not load. Check your connection and try Refresh.', true);
  }
  const count = (value) => Number(value ?? 0).toLocaleString('en-US');
  function price(cents, currency) {
    if (!/^\d+$/.test(cents) || !/^[A-Z]{3}$/.test(currency)) return '—';
    const value = BigInt(cents);
    return currency + ' ' + (value / 100n).toLocaleString('en-US') + '.' + String(value % 100n).padStart(2, '0');
  }
  function stores(items) {
    if (!items.length) return node('div', 'No stores yet. Your storefronts will appear here.', 'empty');
    const cards = node('div', undefined, 'cards');
    for (const store of items) {
      const card = node('article', undefined, 'card');
      card.append(node('h3', store.name), node('p', store.description || 'Your Matjary storefront.'));
      card.append(node('span', count(store.postsCount) + ' posts · ' + count(store.productsCount) + ' products', 'badge'));
      card.append(node('br'), link('Visit storefront →', '/stores/' + encodeURIComponent(store.slug)));
      cards.append(card);
    }
    return cards;
  }
  function records(items, kind) {
    if (!items.length) return node('div', 'No ' + kind + ' yet. Your content will appear here.', 'empty');
    const wrap = node('div', undefined, 'table-wrap');
    const table = node('table');
    table.setAttribute('aria-label', 'My ' + kind);
    const head = node('thead');
    const row = node('tr');
    const headers = kind === 'posts' ? ['Post', 'Store', 'Status', 'Views', 'Likes'] : ['Product', 'Store', 'Status', 'Price', 'Stock'];
    for (const title of headers) { const th = node('th', title); th.scope = 'col'; row.append(th); }
    head.append(row);
    const body = node('tbody');
    for (const item of items) {
      const tr = node('tr');
      tr.append(node('td', item.title ?? item.name));
      const store = node('td');
      if (item.storeSlug) store.append(link(item.storeName || item.storeSlug, '/stores/' + encodeURIComponent(item.storeSlug)));
      else store.textContent = 'No store';
      const status = node('td');
      status.append(node('span', item.status.replace(/_/g, ' '), 'badge'));
      tr.append(store, status);
      if (kind === 'posts') tr.append(node('td', count(item.viewsCount)), node('td', count(item.likesCount)));
      else tr.append(node('td', price(item.priceCents, item.currency)), node('td', item.stockQuantity === null ? 'Not tracked' : count(item.stockQuantity)));
      body.append(tr);
    }
    table.append(head, body); wrap.append(table);
    return wrap;
  }
  function subscription(data) {
    const card = node('section', undefined, 'card');
    const plan = data.subscription;
    card.append(node('h3', plan?.planName || 'Default plan'));
    card.append(node('p', plan ? 'Status: ' + plan.status + (plan.expiresAt ? ' · Ends ' + new Date(plan.expiresAt).toLocaleDateString('en-US') : ' · No expiry date') : 'Your account uses the default free-plan limits.'));
    const limits = node('dl', undefined, 'limits');
    for (const [key, label] of [['maxTotalPosts', 'Total posts'], ['maxPostsPerMonth', 'Posts per month'], ['maxProducts', 'Products'], ['maxImageCount', 'Images per post'], ['maxVideoDurationSeconds', 'Video duration (seconds)']]) {
      const value = data.limits[key];
      const row = node('div');
      row.append(node('dt', label), node('dd', value === null ? 'Unlimited' : value === undefined ? 'Not available' : count(value)));
      limits.append(row);
    }
    card.append(limits, link('Explore available plans →', '/pricing'));
    return card;
  }
  function overview(data) {
    const container = node('div');
    const stats = node('div', undefined, 'stats');
    for (const [label, value, detail] of [
      ['My stores', data.stats.totalStores, 'Your storefronts'],
      ['My posts', data.stats.totalPosts, count(data.stats.publishedPosts) + ' published'],
      ['My products', data.stats.totalProducts, count(data.stats.activeProducts) + ' active'],
      ['Media', data.stats.totalMedia, 'Photos and videos'],
    ]) {
      const card = node('div', undefined, 'stat');
      card.append(node('small', label), node('strong', count(value)), node('small', detail));
      stats.append(card);
    }
    container.append(stats);
    for (const [title, view, content] of [
      ['Your stores', 'stores', stores(data.stores.slice(0, 4))],
      ['Recent posts', 'posts', records(data.posts, 'posts')],
      ['Recent products', 'products', records(data.products, 'products')],
    ]) {
      const heading = node('div', undefined, 'subheading');
      heading.append(node('h3', title), link('View all →', '#' + view));
      container.append(heading, content);
    }
    return container;
  }
  async function load() {
    if (!ready || signingOut) return;
    const view = currentView();
    const current = ++generation;
    $('view-title').textContent = views.get(view)[0];
    $('view-description').textContent = views.get(view)[1];
    for (const item of $('navigation').querySelectorAll('a')) {
      if (item.dataset.view === view) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    $('refresh').disabled = true;
    $('pagination').hidden = true;
    $('content').replaceChildren();
    $('content').setAttribute('aria-busy', 'true');
    message('Loading your ' + view + '…');
    try {
      const paginated = view === 'posts' || view === 'products';
      const path = view === 'stores' ? 'dashboard/stores' : paginated ? 'dashboard/' + view + '?limit=' + pageSize + '&offset=' + offset : 'dashboard';
      const data = await api(path);
      if (current !== generation) return;
      $('content').append(view === 'overview' ? overview(data) : view === 'subscription' ? subscription(data) : view === 'stores' ? stores(data) : records(data[view], view));
      if (paginated) {
        $('pagination').hidden = false;
        $('previous').disabled = offset === 0;
        $('next').disabled = offset + pageSize >= data.total;
        $('page-label').textContent = 'Page ' + (offset / pageSize + 1) + ' · ' + count(data.total) + ' ' + view;
      }
      message('');
    } catch { if (current === generation) failure(); }
    finally { if (current === generation) { $('refresh').disabled = false; $('content').setAttribute('aria-busy', 'false'); } }
  }
  async function initialize() {
    $('refresh').disabled = true;
    try {
      const session = await api('auth/me');
      if (signingOut) return;
      if (session.isAdmin === true) { window.location.replace('/api/v1/admin'); return; }
      $('account-name').textContent = session.user.displayName;
      $('account-email').textContent = session.user.email;
      $('avatar').textContent = session.user.displayName.slice(0, 1).toUpperCase();
      $('welcome-title').textContent = 'Welcome, ' + session.user.displayName;
      ready = true;
      await load();
    } catch { failure(); }
    finally { $('refresh').disabled = false; }
  }
  $('refresh').addEventListener('click', () => ready ? load() : initialize());
  $('previous').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); load(); });
  $('next').addEventListener('click', () => { offset += pageSize; load(); });
  window.addEventListener('hashchange', () => { offset = 0; load(); });
  $('logout').addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    generation++;
    $('logout').disabled = true;
    try {
      await api('auth/logout', {});
      clearAccount();
      window.location.replace('/api/v1/auth/login');
    } catch { message('Sign-out could not finish. Please try again.', true); }
    finally { signingOut = false; $('logout').disabled = false; $('refresh').disabled = false; }
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { clearAccount(); initialize(); } });
  initialize();
})();`;
