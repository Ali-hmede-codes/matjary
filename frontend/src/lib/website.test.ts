import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  brandingUrl,
  contrastColor,
  defaults,
  enableMouseScrolling,
  mediaUrl,
  normalizeSettings,
  parseLikeResponse,
  parseViewResponse,
  isLocalFrontendRequest,
  readSavedIds,
  safeUrl,
} from './website.ts';

test('branding uses public settings and rejects malformed values', () => {
  const settings = normalizeSettings({
    siteName: '  My Store  ',
    primaryColor: '#123abc',
    secondaryColor: 'red',
    logoUrl: 'javascript:alert(1)',
    bannerUrl: '/api/v1/uploads/a%2Fb',
    tagline: null,
    footerText: 'Welcome',
    password: 'not-public',
  });
  assert.equal(settings.siteName, 'My Store');
  assert.equal(settings.primaryColor, '#123abc');
  assert.equal(settings.secondaryColor, defaults.secondaryColor);
  assert.equal(settings.logoUrl, null);
  assert.equal(settings.bannerUrl, '/api/v1/uploads/a%2Fb');
  assert.equal(settings.tagline, null);
  assert.equal(settings.footerText, 'Welcome');
  assert.equal('password' in settings, false);
  assert.deepEqual(normalizeSettings(null), defaults);
});

test('media stays authorized through the proxy and preserves encoded keys', () => {
  assert.equal(
    mediaUrl(
      'http://localhost:3000/api/v1/uploads/A%2Fb.webp',
      'http://localhost:3000',
    ),
    '/api/v1/uploads/A%2Fb.webp',
  );
  assert.equal(
    mediaUrl(
      'http://127.0.0.1:3000/api/v1/uploads/A%2Fb.webp',
      'http://localhost:3000',
    ),
    '/api/v1/uploads/A%2Fb.webp',
  );
  assert.equal(
    mediaUrl('https://cdn.example.com/image.webp', 'http://localhost:3000'),
    'https://cdn.example.com/image.webp',
  );
  assert.equal(
    mediaUrl('/api/v1/uploads/a%2Fb', null),
    '/api/v1/uploads/a%2Fb',
  );
  for (const unsafe of [
    '//evil.example/image',
    '/\\evil.example',
    'javascript:alert(1)',
    'https://user:password@example.com/image',
  ])
    assert.equal(safeUrl(unsafe), undefined);
});

test('branding files get a build stamp while media keys stay immutable', () => {
  assert.equal(brandingUrl('/logo.png', 'abc123'), '/logo.png?v=abc123');
  assert.equal(
    brandingUrl('/favicon.svg?theme=dark', 'abc123'),
    '/favicon.svg?theme=dark&v=abc123',
  );
  assert.equal(
    brandingUrl('/apple-touch-icon.png#tab', 'abc123'),
    '/apple-touch-icon.png?v=abc123#tab',
  );
  // Uploaded variants already carry a unique asset id in the key.
  assert.equal(
    brandingUrl('/api/v1/uploads/media%2Fasset%2Fwebp-480.webp', 'abc123'),
    '/api/v1/uploads/media%2Fasset%2Fwebp-480.webp',
  );
  assert.equal(
    brandingUrl('https://cdn.example.com/logo.png', 'abc123'),
    'https://cdn.example.com/logo.png',
  );
  assert.equal(brandingUrl('/logo.png', ''), '/logo.png');
  assert.equal(brandingUrl(null, 'abc123'), undefined);
  assert.equal(brandingUrl('javascript:alert(1)', 'abc123'), undefined);
});

test('saved IDs tolerate blocked storage and malformed or oversized data', () => {
  assert.deepEqual(
    readSavedIds({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    [],
  );
  assert.deepEqual(readSavedIds({ getItem: () => '{broken' }), []);
  assert.deepEqual(readSavedIds({ getItem: () => '["1",null,2,"1","3"]' }), [
    '1',
    '3',
  ]);
  assert.equal(
    readSavedIds({
      getItem: () =>
        JSON.stringify(Array.from({ length: 600 }, (_, i) => String(i))),
    }).length,
    500,
  );
});

test('like responses accept only bounded counts and explicit viewer state', () => {
  assert.deepEqual(
    parseLikeResponse({ likes: 12, viewerLiked: true, views: 0 }),
    { likes: 12, viewerLiked: true },
  );
  assert.deepEqual(parseLikeResponse({ likes: 0, viewerLiked: false }), {
    likes: 0,
    viewerLiked: false,
  });
  for (const value of [
    null,
    {},
    { likes: -1, viewerLiked: false },
    { likes: 1.5, viewerLiked: true },
    { likes: 1, viewerLiked: 'yes' },
    { likes: Infinity, viewerLiked: false },
    { likes: Number.MAX_SAFE_INTEGER + 1, viewerLiked: true },
  ]) {
    assert.throws(() => parseLikeResponse(value), {
      message: 'Could not update this like.',
    });
  }
});

test('view responses accept only bounded counters', () => {
  assert.deepEqual(parseViewResponse({ views: 12, likes: 3 }), { views: 12 });
  assert.deepEqual(parseViewResponse({ views: 0 }), { views: 0 });
  for (const value of [
    null,
    {},
    { views: -1 },
    { views: 1.5 },
    { views: '3' },
    { views: Infinity },
    { views: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => parseViewResponse(value), {
      message: 'Could not record this view.',
    });
  }
});

test('local mutation bridge rejects missing, cross-origin, and non-preview origins', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const port of ['5173', '4173']) {
      assert.equal(
        isLocalFrontendRequest(`http://${host}:${port}`, `${host}:${port}`),
        true,
      );
    }
  }
  for (const [origin, host] of [
    [undefined, 'localhost:5173'],
    ['null', 'localhost:5173'],
    ['https://evil.example', 'localhost:5173'],
    ['http://localhost:5173', '127.0.0.1:5173'],
    ['http://localhost:3000', 'localhost:3000'],
    ['http://localhost:5173/path', 'localhost:5173'],
    ['http://user:pass@localhost:5173', 'localhost:5173'],
  ])
    assert.equal(isLocalFrontendRequest(origin, host), false);
});

function scrollingRow() {
  const classes = new Set<string>();
  const ownerDocument = Object.assign(new EventTarget(), {
    defaultView: new EventTarget(),
  });
  let captured: number | undefined;
  const element = Object.assign(new EventTarget(), {
    ownerDocument,
    scrollWidth: 400,
    clientWidth: 100,
    scrollLeft: 0,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    setPointerCapture: (id: number) => {
      captured = id;
    },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => {
      captured = undefined;
    },
  });
  const cleanup = enableMouseScrolling(element as unknown as HTMLElement);
  const emit = (
    target: EventTarget,
    type: string,
    properties: Record<string, unknown> = {},
  ) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 120,
      detail: 1,
      ...properties,
    });
    target.dispatchEvent(event);
    return event;
  };
  return {
    element,
    ownerDocument,
    classes,
    cleanup,
    emit,
    captured: () => captured,
  };
}

test('mouse wheel scrolls horizontal rows and releases the page at edges', () => {
  const { element, cleanup, emit } = scrollingRow();
  assert.equal(emit(element, 'wheel', { deltaY: 50 }).defaultPrevented, true);
  assert.equal(element.scrollLeft, 50);
  emit(element, 'wheel', { deltaY: 2, deltaMode: 1 });
  assert.equal(element.scrollLeft, 82);
  emit(element, 'wheel', { deltaY: 1, deltaMode: 2 });
  assert.equal(element.scrollLeft, 182);
  emit(element, 'wheel', { deltaY: 999 });
  assert.equal(element.scrollLeft, 300);
  assert.equal(emit(element, 'wheel', { deltaY: 30 }).defaultPrevented, false);
  emit(element, 'wheel', { deltaY: -999 });
  assert.equal(element.scrollLeft, 0);
  assert.equal(emit(element, 'wheel', { deltaY: -30 }).defaultPrevented, false);
  for (const properties of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { deltaX: 100 },
  ]) {
    assert.equal(
      emit(element, 'wheel', { deltaY: 30, ...properties }).defaultPrevented,
      false,
    );
    assert.equal(element.scrollLeft, 0);
  }
  element.scrollWidth = 100;
  assert.equal(emit(element, 'wheel', { deltaY: 30 }).defaultPrevented, false);
  cleanup?.();
  element.scrollWidth = 400;
  assert.equal(emit(element, 'wheel', { deltaY: 30 }).defaultPrevented, false);
  assert.equal(element.scrollLeft, 0);
});

test('mouse dragging preserves taps, touch scrolling, keyboard clicks and cleanup', () => {
  const { element, ownerDocument, classes, captured, cleanup, emit } =
    scrollingRow();
  emit(element, 'pointerdown');
  emit(ownerDocument, 'pointermove', { clientX: 116 });
  assert.equal(captured(), undefined);
  emit(ownerDocument, 'pointerup');
  assert.equal(emit(element, 'click').defaultPrevented, false);
  emit(element, 'pointerdown');
  emit(ownerDocument, 'pointermove', { clientX: 50 });
  assert.equal(element.scrollLeft, 70);
  assert.equal(captured(), 1);
  assert.equal(classes.has('is-dragging'), true);
  emit(ownerDocument, 'pointerup');
  assert.equal(captured(), undefined);
  assert.equal(classes.has('is-dragging'), false);
  assert.equal(emit(element, 'click', { detail: 0 }).defaultPrevented, false);
  assert.equal(emit(element, 'click').defaultPrevented, true);
  emit(element, 'pointerdown', { pointerType: 'touch' });
  assert.equal(
    emit(ownerDocument, 'pointermove', { pointerType: 'touch', clientX: 0 })
      .defaultPrevented,
    false,
  );
  assert.equal(element.scrollLeft, 70);
  assert.equal(emit(element, 'click').defaultPrevented, false);
  emit(element, 'pointerdown');
  emit(ownerDocument, 'pointermove', { clientX: 100 });
  cleanup?.();
  assert.equal(captured(), undefined);
  assert.equal(classes.has('is-dragging'), false);
  emit(ownerDocument, 'pointermove', { clientX: 0 });
  assert.equal(element.scrollLeft, 90);
  assert.equal(enableMouseScrolling(null), undefined);
});

test('buttons choose readable text for light and dark brand colors', () => {
  assert.equal(contrastColor('#ffffff'), '#17231e');
  assert.equal(contrastColor('#254e40'), '#ffffff');
  assert.equal(contrastColor('#000000'), '#ffffff');
});
