export const ADMIN_SCRIPT = String.raw`'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const schema = window.MATJARY_ADMIN;
  if (!schema) { $('content').textContent = 'The dashboard could not load. Refresh to try again.'; return; }
  const views = schema.views;
  let view = 'overview', generation = 0, offset = 0, filters = {}, monitorWindow = '1h';
  let saving = false, saveAction = null, controls = [], creating = false, currentUserId = null;
  const node = (tag, text, cls) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; };
  const label = (value) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/Id$/, 'ID');
  const button = (text, action, cls = 'secondary') => { const element = node('button', text, cls); element.type = 'button'; element.addEventListener('click', () => Promise.resolve().then(action).catch(failure)); return element; };
  const display = (value) => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  const pill = (value) => node('span', label(String(value ?? 'unknown')), 'pill' + (['down', 'failed', 'suspended', 'firing', 'rejected', 'unavailable'].includes(value) ? ' bad' : ['draft', 'pending', 'archived', 'not_configured'].includes(value) ? ' neutral' : ''));
  const notice = (message, error = false) => { $('notice').hidden = !message; $('notice').textContent = message; $('notice').className = error ? 'error' : ''; };
  function failure(error) {
    if (error.name === 'AbortError') return;
    const message = error.name === 'TimeoutError' ? 'The request timed out. Refresh or try again.' : error.message || 'Unable to complete this request.';
    if ($('editor').open) { $('editor-error').hidden = false; $('editor-error').textContent = message; }
    else notice(message, true);
  }
  async function api(path, method = 'GET', body) {
    const response = await fetch(path.startsWith('/api/') ? path : '/api/v1/admin/' + path, {
      method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) { generation++; $('content').replaceChildren(); $('editor-fields').replaceChildren(); $('record-actions').replaceChildren(); $('editor').close(); location.replace('/api/v1/auth/login'); throw new Error('Your session expired. Sign in again.'); }
      if (response.status === 403) { generation++; $('editor-fields').replaceChildren(); $('record-actions').replaceChildren(); $('editor').close(); $('content').replaceChildren(node('div', 'Administrator access is required.', 'empty')); }
      const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
      throw new Error((typeof message === 'string' ? message : 'Unable to complete this request.') + (data?.requestId ? ' Reference: ' + data.requestId : ''));
    }
    return data;
  }
  function go(name, nextFilters = {}) {
    if ($('editor').open && !saving) $('editor').close();
    filters = nextFilters; offset = 0;
    if (location.hash === '#' + name) { view = name; load().catch(failure); }
    else { pendingFilters = nextFilters; location.hash = name; }
  }
  let pendingFilters = null;
  const navigation = [
    ['WORKSPACE', [['overview', 'Overview', '◫'], ['users', 'Users', '○'], ['stores', 'Stores', '▤'], ['products', 'Products', '◇'], ['posts', 'Posts', '▧'], ['media', 'Media library', '▣']]],
    ['BUSINESS', [['plans', 'Plans', '≡'], ['subscriptions', 'Subscriptions', '↗'], ['campaigns', 'Boost campaigns', '↗'], ['wallets', 'Wallets', '▱'], ['transactions', 'Transactions', '↔'], ['carts', 'Carts', '▤'], ['boost-settings', 'Boost settings', '≡']]],
    ['OPERATIONS', [['website-settings', 'Website settings', '◈'], ['monitoring', 'System monitoring', '⌁'], ['errors', 'Error inbox', '!'], ['audit', 'Audit history', '≡'], ['seo', 'SEO settings', '◎'], ['redirects', 'Redirects', '→']]],
  ];
  for (const [heading, links] of navigation) {
    $('navigation').append(node('div', heading, 'nav-heading'));
    for (const [key, name, icon] of links) { const link = node('a', undefined, 'nav-link'); link.href = '#' + key; link.dataset.view = key; link.append(node('span', icon), document.createTextNode(name)); $('navigation').append(link); }
  }
  function empty(title, description) { const element = node('div', undefined, 'empty'); element.append(node('strong', title), node('span', description)); return element; }
  function healthPanel(health) {
    const panel = node('section', undefined, 'panel'); panel.append(node('h2', 'Service health'), node('p', 'Live dependency and media-worker checks.'));
    for (const key of ['mysql', 'redis', 'worker']) { const row = node('div', undefined, 'health-row'); row.append(node('span', key === 'mysql' ? 'MySQL database' : key === 'redis' ? 'Redis & queues' : 'Media worker'), pill(health?.checks?.[key] ?? 'unavailable')); panel.append(row); }
    if (health) panel.append(node('p', 'Checked ' + new Date(health.timestamp).toLocaleTimeString()));
    return panel;
  }
  async function overview(version) {
    const [countsResult, healthResult, auditResult] = await Promise.allSettled([api('overview'), api('monitoring/health'), api('data/audit?limit=5&offset=0')]);
    if (version !== generation) return;
    const counts = countsResult.status === 'fulfilled' ? countsResult.value : null;
    const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
    const stats = node('div', undefined, 'stats');
    for (const [key, name] of [['users', 'Total users'], ['stores', 'Stores'], ['products', 'Products'], ['posts', 'Published & draft posts'], ['media', 'Media assets'], ['errors', 'Open error issues']]) {
      const card = node('a', undefined, 'stat'); card.href = '#' + key;
      card.append(node('span', name, 'stat-label'), node('span', '↗', 'stat-icon'), node('strong', counts ? Number(counts[key]).toLocaleString() : '—', 'stat-number'), node('span', 'View ' + views[key].label.toLowerCase() + ' →', 'stat-note')); stats.append(card);
    }
    const split = node('div', undefined, 'split');
    const hero = node('section', undefined, 'panel hero-panel'); hero.append(node('h2', 'A clear view of your platform.'), node('p', 'Manage your content, keep an eye on service health, and make changes with a complete audit trail.'));
    const actions = node('div', undefined, 'quick-actions'); actions.append(button('Manage stores', () => go('stores')), button('View VPS resources', () => go('monitoring')), button('Review errors', () => go('errors'))); hero.append(actions);
    split.append(hero, healthPanel(health));
    const activity = node('section', undefined, 'panel'); const top = node('div', undefined, 'panel-top'); const auditLink = node('a', 'View all activity →'); auditLink.href = '#audit'; top.append(node('h2', 'Recent administrative activity'), auditLink); activity.append(top);
    const items = auditResult.status === 'fulfilled' ? auditResult.value.items : null;
    if (!items?.length) activity.append(node('p', items ? 'No administrative changes yet. Your first action will appear here.' : 'Audit history is temporarily unavailable.'));
    else for (const item of items) { const row = node('div', undefined, 'health-row'); row.append(node('span', label(item.action) + ' · ' + item.resource), node('span', new Date(item.createdAt).toLocaleString(), 'muted')); activity.append(row); }
    $('content').replaceChildren(stats, split, activity);
    if (!counts) notice('Platform counts are temporarily unavailable. Other panels may still be available.', true);
  }
  function filterForm() {
    const form = node('form', undefined, 'filters');
    const addInput = (key, placeholder) => { const input = node('input'); input.name = key; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder); input.value = filters[key] || ''; form.append(input); };
    addInput('search', 'Search records…');
    if (['stores', 'products', 'posts', 'media', 'subscriptions', 'campaigns', 'wallets', 'transactions', 'carts', 'audit'].includes(view)) addInput('ownerId', view === 'audit' ? 'Actor user ID' : 'Owner / user ID');
    if (['products', 'posts', 'media', 'subscriptions', 'carts', 'redirects'].includes(view)) addInput('parentId', view === 'media' ? 'Post ID' : view === 'subscriptions' ? 'Plan ID' : 'Store ID');
    if (['products', 'posts', 'media', 'subscriptions', 'campaigns', 'carts', 'errors'].includes(view)) addInput('status', 'Status filter');
    if (['users', 'stores', 'products', 'posts', 'media'].includes(view)) {
      const select = node('select'); select.name = 'archive'; select.setAttribute('aria-label', 'Archive filter');
      for (const [value, title] of [['all', 'All records'], ['active', 'Not archived'], ['archived', 'Archived / suspended']]) { const option = node('option', title); option.value = value; select.append(option); } select.value = filters.archive || 'all'; form.append(select);
    }
    const submit = node('button', 'Apply filters', 'secondary'); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', (event) => { event.preventDefault(); filters = Object.fromEntries([...new FormData(form)].filter(([, value]) => value)); offset = 0; load().catch(failure); });
    return form;
  }
  async function list(version) {
    const name = view, definition = views[name];
    const query = new URLSearchParams({ ...filters, limit: '20', offset: String(offset) });
    const data = await api('data/' + name + '?' + query);
    if (version !== generation) return;
    const form = filterForm(), wrap = node('div', undefined, 'table-wrap'), table = node('table');
    const head = node('thead'), headRow = node('tr');
    for (const key of definition.columns) headRow.append(node('th', label(key)));
    headRow.append(node('th', 'Actions')); head.append(headRow); table.append(head);
    const body = node('tbody');
    for (const item of data.items) {
      const row = node('tr');
      for (const key of definition.columns) { const cell = node('td'); const value = item[key]; if (['status', 'state'].includes(key)) cell.append(pill(value)); else { cell.textContent = display(value); cell.title = display(value); } row.append(cell); }
      const cell = node('td'); cell.append(button('View / manage', () => openRecord(name, item.id || item.userId), 'row-button')); row.append(cell); body.append(row);
    }
    table.append(body); wrap.append(table);
    const pagination = node('div', undefined, 'pagination'); pagination.append(node('span', data.total ? (offset + 1) + '–' + (offset + data.items.length) + ' of ' + data.total + ' records' : '0 records'));
    const buttons = node('div'); const prev = button('← Previous', () => { offset = Math.max(0, offset - 20); return load(); }); const next = button('Next →', () => { offset += 20; return load(); }); prev.disabled = offset === 0; next.disabled = offset + data.items.length >= data.total; buttons.append(prev, next); pagination.append(buttons);
    $('content').replaceChildren(form, data.items.length ? wrap : empty('No matching records', definition.create ? 'Change your filters or create the first record.' : 'Change your filters or refresh to check for new records.'), pagination);
  }
  function openEditor(title, fields, values, onSave, note = '', isCreate = false) {
    if (saving) return;
    saveAction = onSave; creating = isCreate; controls = [];
    $('editor-title').textContent = title; $('editor-note').textContent = note; $('editor-error').hidden = true;
    $('editor-fields').replaceChildren(); $('record-actions').replaceChildren(); $('save-editor').hidden = !onSave;
    $('save-editor').textContent = 'Save changes'; $('save-editor').disabled = false;
    for (const field of fields) {
      const multiline = field.type === 'json' || /description|content|custom|reason|notes/i.test(field.name);
      const wrap = node('div', undefined, 'field' + (multiline ? ' wide' : ''));
      const name = label(field.name); const heading = node('label', name + (field.required ? ' *' : '')); heading.htmlFor = 'field-' + field.name;
      let input;
      if (['boolean', 'select'].includes(field.type)) {
        input = node('select'); const blank = node('option', 'Default / unchanged'); blank.value = ''; input.append(blank);
        for (const optionValue of field.type === 'boolean' ? ['true', 'false'] : field.options) { const option = node('option', field.type === 'boolean' ? optionValue === 'true' ? 'Yes' : 'No' : optionValue); option.value = optionValue; input.append(option); }
      } else { input = node(multiline ? 'textarea' : 'input'); if (!multiline) input.type = field.type === 'date' ? 'datetime-local' : field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : field.type === 'color' ? 'color' : 'text'; }
      input.id = 'field-' + field.name; input.name = field.name; input.required = Boolean(field.required);
      if (field.type === 'number') { input.step = field.name === 'sitemapPriority' ? '0.1' : '1'; input.max = String(Number.MAX_SAFE_INTEGER); }
      let value = values?.[field.name];
      if (field.type === 'date' && value) { const date = new Date(value); value = Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; }
      input.value = value === null || value === undefined ? '' : field.type === 'json' ? JSON.stringify(value, null, 2) : String(value);
      wrap.append(heading, input);
      if (field.type === 'json') wrap.append(node('small', 'Valid JSON. Only supported fields are accepted.'));
      if (['logoUrl', 'faviconUrl', 'bannerUrl'].includes(field.name)) wrap.append(node('small', 'Public HTTPS image URL or /path. This does not upload files or make private media public. Clear to remove.'));
      if (/Id$/.test(field.name)) wrap.append(node('small', 'Use the ID of an existing record. Find IDs in its detail view.'));
      if (field.name === 'indexNowKey') { input.autocomplete = 'new-password'; wrap.append(node('small', 'Write-only. Leave blank to keep the existing key.')); }
      $('editor-fields').append(wrap); controls.push({ field, input, initial: input.value });
    }
    if (!$('editor').open) $('editor').showModal();
  }
  function details(item) {
    const dl = node('dl', undefined, 'record-details');
    for (const [key, value] of Object.entries(item)) { dl.append(node('dt', label(key)), node('dd', display(value))); }
    $('editor-fields').append(dl);
  }
  async function openRecord(name, id) {
    const version = generation;
    const item = await api('data/' + name + '/' + encodeURIComponent(id));
    if (version !== generation) return;
    const definition = views[name];
    if (name === 'stores') item.location = Object.fromEntries(['latitude', 'longitude', 'address', 'city', 'country', 'postalCode', 'locationName', 'phone', 'website', 'openingHours'].filter((key) => item[key] != null).map((key) => [key, item[key]]));
    const editable = name !== 'campaigns' || ['draft', 'pending_review'].includes(item.status);
    const fields = editable ? definition.edit || [] : [];
    openEditor(item.name || item.title || item.displayName || definition.label, fields, item, fields.length ? (data) => api(name + '/' + id, 'PATCH', data) : null, 'Record ID: ' + id);
    details(item);
    const actions = $('record-actions');
    const action = (title, path, extra = {}, method = 'POST') => actions.append(button(title, () => confirmAction(title, path, extra, method)));
    if (['stores', 'products', 'posts', 'media'].includes(name)) action(item.adminArchivedAt ? 'Restore content' : 'Archive content', name + '/' + id + (item.adminArchivedAt ? '/restore' : '/archive'));
    if (name === 'users') {
      if (!item.roleManagedByEnvironment && id !== currentUserId) actions.append(button('Change role', () => openEditor('Change role · ' + item.email, [{ name: 'role', type: 'select', required: true, options: ['user', 'admin'] }, { name: 'reason', type: 'textarea', required: true }], { role: item.role }, (data) => api('users/' + id + '/role', 'PATCH', data), 'Admins have full website-management access, including managing other admins. Changing the role signs this account out; they must sign in again.', true)));
      if (item.roleManagedByEnvironment) actions.append(node('p', 'This administrator is protected by server configuration.'));
      if (!item.roleManagedByEnvironment) action(item.suspendedAt ? 'Restore account' : 'Suspend account', 'users/' + id + (item.suspendedAt ? '/restore' : '/suspend'));
      action('Revoke all sessions', 'users/' + id + '/revoke-sessions');
      actions.append(button('Stores', () => go('stores', { ownerId: id })), button('Subscriptions', () => go('subscriptions', { ownerId: id })), button('Adjust wallet', () => walletForm(id)));
    }
    if (name === 'stores') { action(item.hasVerificationBadge ? 'Revoke badge' : 'Grant badge', 'stores/' + id + '/badge', { enabled: !item.hasVerificationBadge }); actions.append(button('Products', () => go('products', { parentId: id }))); }
    if (name === 'posts') actions.append(button('Upload media', () => uploadForm(id)), button('View media', () => go('media', { parentId: id })));
    if (schema.metadata[name]) actions.append(button('Edit SEO', () => seoForm(name, id)), button('Generate SEO', () => confirmAction('Generate SEO', 'seo/' + ({ stores: 'store', products: 'product', posts: 'showcase' }[name]) + '/' + id + '/generate', {}, 'POST', false)));
    if (name === 'media') { actions.append(button('Preview media', () => preview(id))); if (item.status === 'failed') action('Retry processing', 'media/' + id + '/retry'); }
    if (name === 'wallets') actions.append(button('Adjust balance', () => walletForm(item.userId)), button('Transactions', () => go('transactions', { ownerId: item.userId })));
    if (name === 'subscriptions' && item.status === 'active') action('Cancel subscription', 'subscriptions/' + id + '/cancel');
    if (name === 'plans' && item.slug !== 'free') action('Deactivate plan', 'plans/' + id + '/deactivate');
    if (name === 'campaigns') for (const choice of item.status === 'pending_review' ? ['approve', 'reject', 'cancel'] : item.status === 'active' ? ['pause', 'cancel'] : item.status === 'paused' ? ['resume', 'cancel'] : item.status === 'draft' ? ['cancel'] : []) action(label(choice) + ' campaign', 'campaigns/' + id + '/action', { action: choice });
    if (name === 'carts' && item.status === 'active') action('Expire cart', 'carts/' + id + '/expire');
    if (name === 'errors') for (const state of ['acknowledged', 'resolved', 'open']) if (state !== item.state) action('Mark ' + state, 'errors/' + id, { state }, 'PATCH');
  }
  function confirmAction(title, path, extra = {}, method = 'POST', reasonRequired = true) {
    openEditor(title, reasonRequired ? [{ name: 'reason', type: 'textarea', required: true }] : [], {}, (data) => api(path, method, { ...extra, ...data }), 'Confirm this action. Changes are audited; archived content and financial history are retained.', true);
    $('save-editor').textContent = 'Confirm action';
  }
  function createRecord() { const name = view, definition = views[name]; if (definition?.create) openEditor('Create · ' + definition.label, definition.create, definition.defaults || {}, (data) => api(definition.endpoint || name, 'POST', data), 'Required fields are marked with an asterisk. Accounts are created through Google sign-in.', true); }
  function walletForm(userId = '') {
    openEditor('Adjust wallet balance', [{ name: 'userId', type: 'text', required: true }, { name: 'amount', type: 'number', required: true }, { name: 'description', type: 'textarea', required: true }, { name: 'operationId', type: 'text', required: true }], { userId, operationId: crypto.randomUUID() }, (data) => api('wallets/adjust', 'POST', data), 'Positive amounts grant coins; negative amounts deduct unreserved coins. Keep the operation ID unchanged when retrying this action.', true);
    $('field-operationId').readOnly = true;
  }
  async function seoForm(name, id) {
    const kind = { stores: 'store', products: 'product', posts: 'showcase' }[name];
    const data = await api('seo/' + kind + '/' + id);
    openEditor('Search metadata', schema.metadata[name], data || {}, (body) => api('seo/' + kind + '/' + id, 'PUT', body), 'Metadata belongs to this record. Image keys must belong to its owner.');
  }
  async function preview(id) {
    const data = await api('media/' + id + '/preview');
    const url = new URL(data.url, location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview URL');
    const element = node(data.mimeType.startsWith('video/') ? 'video' : 'img', undefined, 'preview');
    element.src = url.href; element.referrerPolicy = 'no-referrer';
    if (element.tagName === 'VIDEO') element.controls = true; else element.alt = 'Private administrative media preview';
    $('editor-fields').prepend(element);
  }
  function uploadForm(postId) {
    openEditor('Upload post media', [], {}, async () => {
      const file = $('upload-file').files[0]; if (!file) throw new Error('Choose an image or video.');
      const kind = file.type.startsWith('image/') ? 'image' : 'video';
      const negotiated = await api('posts/' + postId + '/media/negotiate', 'POST', { fileName: file.name, fileType: file.type, fileSize: file.size, kind });
      const url = new URL(negotiated.url, location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid upload URL');
      const result = await fetch(url.href, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file, signal: AbortSignal.timeout(300000) });
      if (!result.ok) throw new Error('The media upload did not complete. Refresh and try again.');
      await api('posts/' + postId + '/media/complete', 'POST', { mediaId: negotiated.mediaId });
    }, 'Encoding runs asynchronously in the worker. Owner subscription quotas and upload limits still apply.', true);
    const field = node('div', undefined, 'field wide'); const input = node('input'); input.type = 'file'; input.id = 'upload-file'; input.required = true; input.accept = 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm'; field.append(node('label', 'Image or video'), input); $('editor-fields').append(field);
  }
  async function settings(version) {
    const name = view, definition = views[name]; const data = await api(definition.endpoint);
    if (version !== generation) return;
    const panel = node('section', undefined, 'panel settings-summary'); const text = node('div'); text.append(node('h2', definition.label), node('p', definition.description)); panel.append(text, button('Edit settings', () => openEditor(definition.label, definition.edit, data, (body) => api(definition.endpoint, name === 'seo' ? 'PUT' : 'PATCH', body), 'Only changed fields are saved. Authentication settings and secrets are not exposed.')));
    $('content').replaceChildren(panel);
    if (name === 'seo') { const index = node('section', undefined, 'panel'); index.append(node('h2', 'Notify search engines'), node('p', 'Submit URLs belonging to your configured site origin.'), button('Submit to IndexNow', () => openEditor('Submit to IndexNow', [{ name: 'urls', type: 'json', required: true }], { urls: [] }, (body) => api('seo/indexnow', 'POST', body), 'This sends the listed site URLs to the configured search-engine endpoints.', true))); $('content').append(index); }
  }
  const formatMetric = (value, unit) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable';
    if (unit === 'bytes' || unit === 'bytes/s') { let n = Number(value), i = 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(1) + ' ' + units[i] + (unit.endsWith('/s') ? '/s' : ''); }
    if (unit === 'seconds' && value > 3600) return (value / 86400).toFixed(1) + ' days';
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit;
  };
  function chart(metric) {
    const panel = node('section', undefined, 'panel metric-panel'); panel.append(node('h2', metric.label), node('strong', formatMetric(metric.current, metric.unit)));
    const valid = metric.points.filter((point) => point[1] !== null && Number.isFinite(point[1]));
    if (valid.length > 1) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 400 100'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', metric.label + ' history');
      const path = document.createElementNS(svg.namespaceURI, 'path'); const max = metric.unit === '%' ? 100 : Math.max(1, ...valid.map((point) => point[1]));
      let drawing = false, d = ''; metric.points.forEach((point, index) => { if (point[1] === null || !Number.isFinite(point[1])) { drawing = false; return; } const x = 5 + index / Math.max(1, metric.points.length - 1) * 390; const y = 90 - Math.min(1, Math.max(0, point[1] / max)) * 80; d += (drawing ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2) + ' '; drawing = true; });
      path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); svg.append(path); panel.append(svg);
      const detail = node('details'); detail.append(node('summary', 'View sample values')); const table = node('table'); for (const point of metric.points) { const row = node('tr'); row.append(node('td', new Date(point[0] * 1000).toLocaleString()), node('td', formatMetric(point[1], metric.unit))); table.append(row); } detail.append(table); panel.append(detail);
    } else panel.append(node('p', 'History appears after the collector has enough samples.'));
    return panel;
  }
  async function monitoring(version) {
    const [health, vps, alerts] = await Promise.all([api('monitoring/health'), api('monitoring/vps?window=' + monitorWindow), api('monitoring/alerts')]);
    if (version !== generation) return;
    const toolbar = node('div', undefined, 'monitor-toolbar'); const select = node('select'); select.setAttribute('aria-label', 'Monitoring time window'); for (const value of ['1h', '24h', '7d']) { const option = node('option', value); option.value = value; select.append(option); } select.value = monitorWindow; select.addEventListener('change', () => { monitorWindow = select.value; load().catch(failure); }); toolbar.append(select, node('span', 'Refreshes every 15 seconds while visible.', 'muted'));
    const split = node('div', undefined, 'split'); const process = node('section', undefined, 'panel'); process.append(node('h2', 'Application processes'), node('p', 'These are process measurements, not whole-VPS resources.'));
    for (const [name, value] of [['API memory', formatMetric(health.api?.rssBytes, 'bytes')], ['Worker memory', formatMetric(health.worker?.rssBytes, 'bytes')], ['Failed media', display(health.media?.failed)], ['Outbox age', formatMetric(health.media?.outboxAgeSeconds, 'seconds')], ['Media queue waiting', display(health.queues?.media?.waiting)], ['Cleanup candidates', display(health.media?.cleanupCandidates)]]) { const row = node('div', undefined, 'health-row'); row.append(node('span', name), node('strong', value)); process.append(row); }
    split.append(healthPanel(health), process);
    const alertPanel = node('section', undefined, 'panel'); alertPanel.append(node('h2', 'Active alerts')); if (alerts.status !== 'up') alertPanel.append(node('p', 'Alert collection is ' + alerts.status.replaceAll('_', ' ') + '.')); else if (!alerts.items.length) alertPanel.append(node('p', 'No active alert rules are firing.')); for (const alert of alerts.items) alertPanel.append(node('div', label(alert.name) + ' · ' + alert.state, 'alert-item'));
    const title = node('section', undefined, 'panel'); title.append(node('h2', 'VPS resources'), node('p', vps.scope), pill(vps.status));
    if (vps.status !== 'up') title.append(node('p', vps.status === 'not_configured' ? 'The private Linux VPS collector has not been configured. Local Windows or container readings are not substituted for your VPS.' : 'The collector is unavailable. Historical samples may be shown, but current values are not live.'));
    const charts = node('div', undefined, 'monitor-grid'); for (const metric of vps.metrics || []) charts.append(chart(metric));
    $('content').replaceChildren(toolbar, split, alertPanel, title, charts);
  }
  async function load() {
    const version = ++generation;
    const definition = views[view]; const name = view === 'overview' ? 'Overview' : view === 'monitoring' ? 'System monitoring' : definition?.label;
    $('title').textContent = name; $('breadcrumb').textContent = name;
    $('description').textContent = view === 'overview' ? 'Welcome back. Here’s what’s happening across your platform.' : view === 'monitoring' ? 'Errors, service health, and a real view of your VPS resources.' : definition.description;
    document.querySelectorAll('.nav-link').forEach((link) => { link.classList.toggle('active', link.dataset.view === view); if (link.dataset.view === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    $('create').hidden = !definition?.create && view !== 'wallets'; $('create').textContent = view === 'wallets' ? 'Adjust balance' : '+ Create';
    $('content').setAttribute('aria-busy', 'true'); $('content').replaceChildren(empty('Loading…', 'Fetching the latest workspace data.')); notice('');
    try { if (view === 'overview') await overview(version); else if (view === 'monitoring') await monitoring(version); else if (definition.settings) await settings(version); else await list(version); }
    catch (error) { if (version === generation) { $('content').replaceChildren(empty('This view is unavailable', 'Refresh to try again. Your changes have not been resubmitted.')); throw error; } }
    finally { if (version === generation) $('content').setAttribute('aria-busy', 'false'); }
  }
  $('editor-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (saving || !saveAction) return;
    saving = true; $('save-editor').disabled = true; $('close-editor').disabled = true; $('cancel-editor').disabled = true; $('editor-error').hidden = true;
    try {
      const body = {};
      for (const { field, input, initial } of controls) {
        if (!creating && input.value === initial) continue;
        if (input.value === '') { if (!creating && field.nullable) body[field.name] = null; continue; }
        if (field.type === 'json') { try { body[field.name] = JSON.parse(input.value); } catch { throw new Error(label(field.name) + ' must contain valid JSON.'); } }
        else if (field.type === 'number') { const number = Number(input.value); if (!Number.isFinite(number) || (field.name !== 'sitemapPriority' && !Number.isSafeInteger(number))) throw new Error(label(field.name) + ' must be an exact integer.'); body[field.name] = number; }
        else if (field.type === 'boolean') body[field.name] = input.value === 'true';
        else if (field.type === 'date') body[field.name] = new Date(input.value).toISOString();
        else body[field.name] = input.value;
      }
      if (body.reason && body.reason.trim().length < 3) throw new Error('Please give a reason of at least 3 characters.');
      const result = await saveAction(body);
      $('editor').close(); await load();
      notice(result?.success === false ? 'The action was recorded, but the external service did not confirm success.' : 'Changes saved. The action has been recorded in audit history.', result?.success === false);
    } catch (error) { failure(error); }
    finally { saving = false; $('save-editor').disabled = false; $('close-editor').disabled = false; $('cancel-editor').disabled = false; }
  });
  $('close-editor').addEventListener('click', () => { if (!saving) $('editor').close(); });
  $('cancel-editor').addEventListener('click', () => { if (!saving) $('editor').close(); });
  $('editor').addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  $('refresh').addEventListener('click', () => load().catch(failure));
  $('create').addEventListener('click', () => { if (view === 'wallets') walletForm(); else createRecord(); });
  $('logout').addEventListener('click', async () => { try { await api('/api/v1/auth/logout', 'POST', {}); location.replace('/api/v1/auth/login'); } catch (error) { failure(error); } });
  function route() { const next = location.hash.slice(1); view = next === 'monitoring' || next === 'overview' || Object.hasOwn(views, next) ? next : 'overview'; filters = pendingFilters || {}; pendingFilters = null; offset = 0; load().catch(failure); }
  window.addEventListener('hashchange', route);
  setInterval(() => { if (view === 'monitoring' && !document.hidden && !$('editor').open && $('content').getAttribute('aria-busy') !== 'true') load().catch(failure); }, 15000);
  api('/api/v1/auth/me').then((data) => {
    if (!data.isAdmin) { $('content').replaceChildren(empty('Access denied', 'This Google account is not an administrator.')); return; }
    currentUserId = data.user.id;
    $('account-name').textContent = data.user.displayName; $('account-email').textContent = data.user.email; $('avatar').textContent = data.user.displayName.slice(0, 1).toUpperCase(); route();
  }).catch(failure);
})();`;
