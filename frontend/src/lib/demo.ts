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

const demoBusinessCategories = [
  ['handmade_crafts', 'Handmade & crafts', 'ecommerce'],
  ['cafe', 'Café / coffee shop', 'restaurant_menu'],
  ['home_furniture', 'Furniture', 'ecommerce'],
  ['restaurants', 'Restaurant', 'restaurant_menu'],
  ['flower_shop', 'Flowers', 'ecommerce'],
  ['clothing_store', 'Clothing store', 'ecommerce'],
] as const;

export const demoStores: Store[] = examples.map(
  ([name, , description, photo], index) => {
    const business = demoBusinessCategories[index] ?? [
      'other',
      'Other business',
      'ecommerce',
    ];
    return {
      id: `demo-store-${index}`,
      slug: `demo-store-${index}`,
      name,
      hasVerificationBadge: index === 0 || index === 1 || index === 3,
      verificationBadgeExpiresAt: index === 3 ? '2020-01-01T00:00:00Z' : null,
      brandColor:
        ['#75604b', '#88452c', '#384e60', '#637348', '#426751', '#91614c'][
          index
        ] ?? null,
      storeType:
        business[2] === 'restaurant_menu' ? 'restaurant_menu' : 'ecommerce',
      businessCategory: business[0],
      businessCategoryLabel: business[1],
      description,
      bannerKey: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1600&q=85`,
      socialMediaLinks: {
        instagram: 'https://instagram.com/matjary',
        facebook: 'https://facebook.com/matjary',
        tiktok: 'https://tiktok.com/@matjary',
      },
      branches: [
        {
          id: `demo-branch-${index}-main`,
          name: 'Main store',
          address: '12 Mar Mikhael Street',
          city: 'Beirut',
          country: 'Lebanon',
          latitude: 33.8938 + index * 0.004,
          longitude: 35.5018 + index * 0.004,
          phone: '+961 1 234 567',
          whatsapp: '96170123456',
          whatsappUrl: 'https://wa.me/96170123456',
          isPrimary: true,
          openingHours: {
            mon: '09:00-18:00',
            tue: '09:00-18:00',
            wed: '09:00-18:00',
            thu: '09:00-18:00',
            fri: '09:00-18:00',
            sat: '10:00-16:00',
            sun: null,
          },
        },
        {
          id: `demo-branch-${index}-sea`,
          name: 'Seaside branch',
          address: 'Ain el Mreisseh Corniche',
          city: 'Beirut',
          country: 'Lebanon',
          latitude: 33.8995 + index * 0.004,
          longitude: 35.4765 + index * 0.004,
          phone: '+961 1 987 654',
          whatsapp: '96170987654',
          whatsappUrl: 'https://wa.me/96170987654',
          openingHours: {
            mon: '10:00-20:00',
            tue: '10:00-20:00',
            wed: '10:00-20:00',
            thu: '10:00-20:00',
            fri: '10:00-20:00',
            sat: '10:00-20:00',
            sun: '11:00-18:00',
          },
        },
      ],
      location: { city: 'Beirut', country: 'Lebanon' },
    };
  },
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
    (productNames[storeIndex] ?? []).map((name, index) => {
      const basePrice = (storeIndex === 1 ? 350 : 1800) + index * 250;
      return {
        id: `demo-product-${storeIndex}-${index}`,
        storeId: `demo-store-${storeIndex}`,
        slug: `demo-product-${storeIndex}-${index}`,
        name,
        description,
        priceCents: String(basePrice),
        currency: 'USD',
        // One sample item is sold out and one is low so the preview shows the
        // availability states shoppers see on a live menu.
        status: storeIndex === 1 && index === 2 ? 'out_of_stock' : 'active',
        category: storeIndex === 3 && index === 2 ? 'beverage' : category,
        stockQuantity: storeIndex === 0 && index === 1 ? 3 : null,
        imageKeys: [
          `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=600&q=85`,
        ],
        tags: null,
        options:
          storeIndex === 0 && index === 0
            ? [
                {
                  name: 'Color',
                  values: [
                    { label: 'Sand', priceCents: null },
                    { label: 'Forest', priceCents: null },
                    { label: 'Terracotta', priceCents: null },
                  ],
                },
                {
                  name: 'Size',
                  values: [
                    { label: '250 ml', priceCents: null },
                    // Own price replaces the base price, not an addition.
                    { label: '400 ml', priceCents: '2050' },
                  ],
                },
              ]
            : storeIndex === 1
              ? [
                  {
                    name: 'Size',
                    values: [
                      { label: 'Small', priceCents: null },
                      { label: 'Medium', priceCents: String(basePrice + 50) },
                      { label: 'Large', priceCents: String(basePrice + 100) },
                    ],
                  },
                ]
              : null,
      };
    }),
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
    // Sample counters keep the design preview representative of live posts.
    engagement: {
      likes: [128, 64, 342, 211, 87, 156][index] ?? 0,
      views: [2400, 980, 6100, 3700, 1420, 2900][index] ?? 0,
      viewerLiked: false,
    },
    // Two sample shoppable posts so the design preview shows both link kinds.
    ...(index === 0
      ? {
          link: {
            type: 'product' as const,
            name: 'Everyday ceramic mug',
            slug: 'demo-product-0-0',
            priceCents: '1800',
            currency: 'USD',
          },
        }
      : index === 1
        ? {
            link: {
              type: 'category' as const,
              name: 'Beverage',
              slug: null,
              priceCents: null,
              currency: null,
            },
          }
        : {}),
  }),
);
