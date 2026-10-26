import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  branchDirectionsUrl,
  branchOpenState,
  branchWhatsAppHref,
  formatDistance,
  hoursLabel,
  isGoogleMapsUrl,
  parseTimeRange,
  sortBranchesByDistance,
  storeBranches,
} from './branches.ts';
import type { StoreBranch } from './api.ts';

const baseBranch: StoreBranch = {
  id: 'branch-a',
  name: 'Main store',
  city: 'Beirut',
  country: 'Lebanon',
  latitude: 33.8938,
  longitude: 35.5018,
};

test('opening hours parse, format, and detect open and closed states', () => {
  assert.deepEqual(parseTimeRange('09:00-18:00'), { open: 540, close: 1080 });
  assert.deepEqual(parseTimeRange('9:00–18:00'), { open: 540, close: 1080 });
  assert.equal(hoursLabel('09:00-18:00'), '9:00 AM – 6:00 PM');
  assert.equal(hoursLabel(null), 'Closed');

  const mondayMorning = new Date('2026-10-26T10:00:00');
  assert.equal(
    branchOpenState({ mon: '09:00-18:00' }, mondayMorning)?.open,
    true,
  );
  assert.equal(
    branchOpenState({ mon: '09:00-18:00' }, mondayMorning)?.label,
    'Open now · until 6:00 PM',
  );
  assert.equal(
    branchOpenState({ mon: '09:00-18:00' }, mondayMorning)?.detail,
    'until 6:00 PM',
  );
  const mondayEvening = new Date('2026-10-26T20:00:00');
  assert.equal(
    branchOpenState({ mon: '09:00-18:00', tue: '10:00-18:00' }, mondayEvening)
      ?.label,
    'Closed · opens Tue 10:00 AM',
  );
  assert.equal(
    branchOpenState({ mon: '09:00-18:00', tue: '10:00-18:00' }, mondayEvening)
      ?.detail,
    'opens Tue 10:00 AM',
  );
  assert.equal(branchOpenState({}), null);
});

test('overnight hours stay open after midnight', () => {
  const oneAmTuesday = new Date('2026-10-27T01:00:00');
  assert.equal(
    branchOpenState({ mon: '18:00-02:00' }, oneAmTuesday)?.open,
    true,
  );
});

test('directions prefer a saved Google Maps link only from Google hosts', () => {
  const googleBranch: StoreBranch = {
    ...baseBranch,
    googleMapsUrl: 'https://maps.app.goo.gl/sample',
  };
  assert.equal(
    branchDirectionsUrl(googleBranch),
    'https://maps.app.goo.gl/sample',
  );
  assert.equal(isGoogleMapsUrl('https://www.google.com/maps/place/Shop'), true);
  assert.equal(isGoogleMapsUrl('https://goo.gl/maps/sample'), true);
  assert.equal(isGoogleMapsUrl('https://evil.test/maps/place/Shop'), false);
  assert.equal(isGoogleMapsUrl('http://www.google.com/maps/place/Shop'), false);
  assert.equal(
    branchDirectionsUrl({
      ...googleBranch,
      googleMapsUrl: 'https://evil.test/maps/place/Shop',
    }),
    'https://www.openstreetmap.org/?mlat=33.8938&mlon=35.5018#map=16/33.8938/35.5018',
  );
});

test('branch WhatsApp links never trust arbitrary destinations', () => {
  assert.equal(
    branchWhatsAppHref({ id: 'a', name: 'A', whatsapp: '96170123456' }),
    'https://wa.me/96170123456',
  );
  assert.equal(
    branchWhatsAppHref({
      id: 'a',
      name: 'A',
      whatsappUrl: 'https://example.test/not-whatsapp',
      whatsapp: '123',
    }),
    undefined,
  );
  assert.equal(
    branchWhatsAppHref({
      id: 'a',
      name: 'A',
      whatsappUrl: 'javascript:alert(1)',
      whatsapp: '96170123456',
    }),
    'https://wa.me/96170123456',
  );
});

test('legacy shop locations become a single primary branch', () => {
  const branches = storeBranches({
    location: {
      city: 'Tripoli',
      country: 'Lebanon',
      address: 'Main road',
      phone: '+961 6 123 456',
      openingHours: { monday: '09:00-17:00' },
    },
    socialMediaLinks: { whatsapp: 'https://wa.me/96170123456' },
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.name, 'Tripoli');
  assert.equal(branches[0]?.isPrimary, true);
  assert.equal(branches[0]?.whatsapp, '96170123456');
  assert.equal(storeBranches({ branches: [baseBranch] })[0]?.id, 'branch-a');
  assert.deepEqual(storeBranches({}), []);
});

test('nearest branch sorting keeps unmapped branches last', () => {
  const unmapped: StoreBranch = { id: 'c', name: 'No pin' };
  const far: StoreBranch = {
    ...baseBranch,
    id: 'b',
    latitude: 34.436,
    longitude: 35.85,
  };
  const ordered = sortBranchesByDistance([unmapped, far, baseBranch], {
    latitude: 33.8938,
    longitude: 35.5018,
  });
  assert.deepEqual(
    ordered.map((branch) => branch.id),
    ['branch-a', 'b', 'c'],
  );
  assert.equal(formatDistance(0.35), '350 m away');
  assert.equal(formatDistance(12.3), '12 km away');
});
