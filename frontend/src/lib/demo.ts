import type { Post, Store } from './api';

// Opt-in visual examples only. Never substituted for real API results silently.
export const inspirationPhoto =
  'https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=900&q=85';
const examples = [
  [
    'Sunday Studio',
    'Objects with a little soul.',
    'Slow mornings, handmade ceramics, and a moment just for you.',
    'photo-1490312278390-ab64016e0aa9',
    'merchandise',
  ],
  [
    'The Daily Grind',
    'Your daily dose of good.',
    'Freshly brewed. Thoughtfully made. Take a little time for yourself.',
    'photo-1442512595331-e89e73853f31',
    'beverage',
  ],
  [
    'Form & Field',
    'Make room for beautiful.',
    'Quiet corners and considered details for a home that feels like you.',
    'photo-1600210492486-724fe5c67fb0',
    'merchandise',
  ],
  [
    'Olive Kitchen',
    'Something worth sharing.',
    'Good ingredients, good company, and a seat at our table.',
    'photo-1512621776951-a57141f2eefd',
    'food',
  ],
  [
    'Wildflower',
    'A little closer to nature.',
    'Bring the outdoors in with fresh greens and everyday rituals.',
    'photo-1416879595882-3373a0480b5b',
    'merchandise',
  ],
  [
    'Everyday Goods',
    'The simple things, done well.',
    'Timeless pieces for wherever the day takes you.',
    'photo-1548036328-c9fa89d128fa',
    'merchandise',
  ],
] as const;

export const demoStores: Store[] = examples.map(([name], index) => ({
  id: `demo-store-${index}`,
  slug: `demo-store-${index}`,
  name,
  brandColor: null,
  description: 'Independent finds, thoughtfully curated.',
}));

export const demoPosts: (Post & { category: string })[] = examples.map(
  ([, title, description, photo, category], index) => ({
    id: `demo-${index}`,
    slug: `demo-${index}`,
    title,
    description,
    publishedAt: null,
    store: demoStores[index],
    category,
    media: [
      {
        id: `demo-media-${index}`,
        kind: 'image',
        primaryUrl: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=900&q=85`,
        posterUrl: null,
        variants: [],
      },
    ],
    engagement: { likes: 0, views: 0, viewerLiked: false },
  }),
);
