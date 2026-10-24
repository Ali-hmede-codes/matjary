import type { Post, Product, Store } from './api';

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

export const demoStores: Store[] = examples.map(
  ([name, , description, photo, category], index) => ({
    id: `demo-store-${index}`,
    slug: `demo-store-${index}`,
    name,
    hasVerificationBadge: index === 0 || index === 1 || index === 3,
    verificationBadgeExpiresAt: index === 3 ? '2020-01-01T00:00:00Z' : null,
    brandColor:
      ['#75604b', '#88452c', '#384e60', '#637348', '#426751', '#91614c'][
        index
      ] ?? null,
    storeType: category === 'merchandise' ? 'ecommerce' : 'restaurant_menu',
    description,
    bannerKey: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1600&q=85`,
    location: { city: 'Beirut', country: 'Lebanon' },
  }),
);

const productNames = [
  ['Everyday ceramic mug', 'Handmade serving bowl', 'Sunday breakfast set'],
  ['House espresso', 'Iced oat latte', 'Morning pour-over'],
  ['The lounge chair', 'Linen cushion', 'Oak side table'],
  ['Garden harvest bowl', 'Seasonal lunch plate', 'Fresh lemonade'],
  ['Fresh green arrangement', 'Terracotta planter', 'Everyday herb set'],
  ['Everyday tote', 'Weekend bag', 'The little carryall'],
];

export const demoProducts: Product[] = examples.flatMap(
  ([, , description, photo, category], storeIndex) =>
    (productNames[storeIndex] ?? []).map((name, index) => ({
      id: `demo-product-${storeIndex}-${index}`,
      storeId: `demo-store-${storeIndex}`,
      slug: `demo-product-${storeIndex}-${index}`,
      name,
      description,
      priceCents: String((storeIndex === 1 ? 350 : 1800) + index * 250),
      currency: 'USD',
      category: storeIndex === 3 && index === 2 ? 'beverage' : category,
      stockQuantity: null,
      imageKeys: [
        `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=600&q=85`,
      ],
      tags: null,
    })),
);

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
