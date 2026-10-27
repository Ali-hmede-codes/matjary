import { contrastColor } from './website.ts';

// ---------------------------------------------------------------------------
// Saved shape
// ---------------------------------------------------------------------------
// The API stores this inside stores.design_settings (JSON). Every value is a
// small, code-owned key: an unknown or stale key falls back instead of breaking
// a live shop page. Keep the key lists in sync with
// backend/apps/api/src/modules/stores/dto/store-design.dto.ts.
export const designTemplates = [
  'atelier',
  'boutique',
  'bloom',
  'editorial',
  'studio',
  'noir',
  'bazaar',
  'table',
  'roast',
  'fresh',
  'arcade',
] as const;
export type DesignTemplate = (typeof designTemplates)[number];

export const designPalettes = [
  'ivory',
  'sand',
  'blush',
  'sage',
  'ocean',
  'clay',
  'mono',
  'night',
] as const;
export type DesignPalette = (typeof designPalettes)[number];

export const designTypographies = [
  'modern',
  'editorial',
  'warm',
  'display',
  'mono',
] as const;
export type DesignTypography = (typeof designTypographies)[number];

export const designShapes = ['soft', 'round', 'pill', 'sharp'] as const;
export type DesignShape = (typeof designShapes)[number];

export const designDensities = ['airy', 'balanced', 'compact'] as const;
export type DesignDensity = (typeof designDensities)[number];

export const designHeroes = [
  'classic',
  'split',
  'poster',
  'minimal',
  'immersive',
] as const;
export type DesignHero = (typeof designHeroes)[number];

export const postLayouts = [
  'grid',
  'masonry',
  'rail',
  'spotlight',
  'mosaic',
  'frames',
] as const;
export type PostLayout = (typeof postLayouts)[number];

export const catalogLayouts = [
  'list',
  'cards',
  'compact',
  'menu',
  'gallery',
  'featured',
  'shelves',
] as const;
export type CatalogLayout = (typeof catalogLayouts)[number];

export const designRhythms = [
  'uniform',
  'alternate',
  'every2',
  'every3',
  'custom',
] as const;
export type DesignRhythm = (typeof designRhythms)[number];

export interface DesignCategoryLayout {
  categoryId: string;
  layout: CatalogLayout;
}

/** Raw JSON as returned by the API; every field is untrusted. */
export interface DesignSettingsInput {
  template?: string | null;
  palette?: string | null;
  typography?: string | null;
  shape?: string | null;
  density?: string | null;
  hero?: string | null;
  postsLayout?: string | null;
  catalogLayout?: string | null;
  accentLayout?: string | null;
  rhythm?: string | null;
  categoryLayouts?:
    { categoryId?: string | null; layout?: string | null }[] | null;
  showProductImages?: boolean | null;
  showProductDescriptions?: boolean | null;
}

/** Fully resolved design, safe to pass straight into components. */
export interface StoreDesign {
  template: DesignTemplate;
  palette: DesignPalette;
  typography: DesignTypography;
  shape: DesignShape;
  density: DesignDensity;
  hero: DesignHero;
  postsLayout: PostLayout;
  catalogLayout: CatalogLayout;
  accentLayout: CatalogLayout;
  rhythm: DesignRhythm;
  categoryLayouts: DesignCategoryLayout[];
  showProductImages: boolean;
  showProductDescriptions: boolean;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const paletteTokens: Record<
  DesignPalette,
  { surface: string; ink: string; accent: string; label: string }
> = {
  ivory: {
    surface: '#fffdf7',
    ink: '#211f1a',
    accent: '#b98a4b',
    label: 'Ivory',
  },
  sand: {
    surface: '#f8f2e7',
    ink: '#2c261d',
    accent: '#9c6b3f',
    label: 'Sand',
  },
  blush: {
    surface: '#fdf4f2',
    ink: '#382a2c',
    accent: '#b76b7a',
    label: 'Blush',
  },
  sage: {
    surface: '#f5f8f2',
    ink: '#212a22',
    accent: '#6f8a5f',
    label: 'Sage',
  },
  ocean: {
    surface: '#f2f7f9',
    ink: '#16262c',
    accent: '#3f7d8f',
    label: 'Ocean',
  },
  clay: {
    surface: '#fbf3ea',
    ink: '#33241a',
    accent: '#a45f3a',
    label: 'Clay',
  },
  mono: {
    surface: '#ffffff',
    ink: '#101010',
    accent: '#101010',
    label: 'Mono',
  },
  night: {
    surface: '#15171c',
    ink: '#f3f0e8',
    accent: '#d7c7a5',
    label: 'Night',
  },
};

const typographyTokens: Record<
  DesignTypography,
  {
    label: string;
    display: string;
    body: string;
    weight: string;
    spacing: string;
  }
> = {
  modern: {
    label: 'Modern sans',
    display: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    body: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    weight: '700',
    spacing: '-0.02em',
  },
  editorial: {
    label: 'Editorial serif',
    display:
      "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    body: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    weight: '600',
    spacing: '-0.01em',
  },
  warm: {
    label: 'Warm humanist',
    display: "'Cairo Variable', 'Segoe UI', 'DM Sans Variable', sans-serif",
    body: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    weight: '700',
    spacing: '0em',
  },
  display: {
    label: 'Display serif',
    display: "'Bodoni MT', Didot, 'Playfair Display', Georgia, serif",
    body: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    weight: '500',
    spacing: '0.005em',
  },
  mono: {
    label: 'Studio mono',
    display:
      "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
    body: "'DM Sans Variable', 'Cairo Variable', system-ui, sans-serif",
    weight: '600',
    spacing: '-0.03em',
  },
};

const shapeTokens: Record<
  DesignShape,
  { label: string; radius: string; tile: string; control: string; note: string }
> = {
  soft: {
    label: 'Soft',
    radius: '20px',
    tile: '14px',
    control: '12px',
    note: 'Gentle, familiar corners.',
  },
  round: {
    label: 'Round',
    radius: '28px',
    tile: '22px',
    control: '16px',
    note: 'Friendly and generous.',
  },
  pill: {
    label: 'Pill',
    radius: '30px',
    tile: '24px',
    control: '999px',
    note: 'Rounded controls everywhere.',
  },
  sharp: {
    label: 'Sharp',
    radius: '3px',
    tile: '2px',
    control: '2px',
    note: 'Editorial, architectural edges.',
  },
};

const densityTokens: Record<
  DesignDensity,
  { label: string; gap: string; pad: string; note: string }
> = {
  airy: {
    label: 'Airy',
    gap: '46px',
    pad: '26px',
    note: 'Lots of breathing room.',
  },
  balanced: {
    label: 'Balanced',
    gap: '32px',
    pad: '20px',
    note: 'Comfortable everyday spacing.',
  },
  compact: {
    label: 'Compact',
    gap: '22px',
    pad: '14px',
    note: 'More on screen at once.',
  },
};

export const postLayoutInfo: Record<
  PostLayout,
  { label: string; hint: string }
> = {
  grid: { label: 'Grid', hint: 'Even, clean tiles.' },
  masonry: { label: 'Masonry', hint: 'Mixed heights, gallery flow.' },
  rail: { label: 'Rail', hint: 'A swipeable strip of posts.' },
  spotlight: { label: 'Spotlight', hint: 'One hero post, then the rest.' },
  mosaic: { label: 'Mosaic', hint: 'Bold mixed-size collage.' },
  frames: { label: 'Frames', hint: 'Framed, spaced-out gallery.' },
};

export const catalogLayoutInfo: Record<
  CatalogLayout,
  { label: string; hint: string }
> = {
  list: { label: 'Classic rows', hint: 'Photo, name, description, price.' },
  cards: { label: 'Photo cards', hint: 'A visual grid of products.' },
  compact: { label: 'Price list', hint: 'Fast to scan, no photos.' },
  menu: { label: 'Menu', hint: 'Dotted prices, editorial feel.' },
  gallery: { label: 'Gallery', hint: 'Image-first tiles with overlay.' },
  featured: { label: 'Featured', hint: 'One hero item, then a grid.' },
  shelves: { label: 'Shelves', hint: 'A swipeable row of products.' },
};

export const rhythmInfo: Record<DesignRhythm, { label: string; hint: string }> =
  {
    uniform: {
      label: 'One style everywhere',
      hint: 'Every section uses the same layout.',
    },
    alternate: {
      label: 'Alternate',
      hint: 'First style, second style, repeat.',
    },
    every2: {
      label: 'Every 2 sections',
      hint: 'Two sections of one style, then two of the other.',
    },
    every3: {
      label: 'Every 3 sections',
      hint: 'Three sections of one style, then three of the other.',
    },
    custom: {
      label: 'Choose each section',
      hint: 'Pick the exact layout for every menu section.',
    },
  };

export interface DesignPreset {
  id: DesignTemplate;
  name: string;
  tagline: string;
  bestFor: string;
  palette: DesignPalette;
  typography: DesignTypography;
  shape: DesignShape;
  density: DesignDensity;
  hero: DesignHero;
  postsLayout: PostLayout;
  catalogLayout: CatalogLayout;
  accentLayout: CatalogLayout;
  rhythm: DesignRhythm;
}

// Eleven starting points, each a complete system rather than a colour swap.
export const designPresets: readonly DesignPreset[] = [
  {
    id: 'atelier',
    name: 'Atelier',
    tagline: 'An editorial gallery for considered brands.',
    bestFor: 'Fashion · beauty · objects',
    palette: 'ivory',
    typography: 'editorial',
    shape: 'soft',
    density: 'airy',
    hero: 'poster',
    postsLayout: 'frames',
    catalogLayout: 'gallery',
    accentLayout: 'featured',
    rhythm: 'alternate',
  },
  {
    id: 'boutique',
    name: 'Boutique',
    tagline: 'Curated, calm, and product-first.',
    bestFor: 'Clothing · accessories',
    palette: 'sand',
    typography: 'editorial',
    shape: 'round',
    density: 'airy',
    hero: 'classic',
    postsLayout: 'spotlight',
    catalogLayout: 'featured',
    accentLayout: 'cards',
    rhythm: 'every2',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    tagline: 'Soft shapes with a romantic glow.',
    bestFor: 'Makeup · flowers · gifts',
    palette: 'blush',
    typography: 'warm',
    shape: 'pill',
    density: 'airy',
    hero: 'immersive',
    postsLayout: 'masonry',
    catalogLayout: 'gallery',
    accentLayout: 'cards',
    rhythm: 'alternate',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    tagline: 'Magazine rhythm and generous whitespace.',
    bestFor: 'Studios · design · photography',
    palette: 'ivory',
    typography: 'display',
    shape: 'sharp',
    density: 'airy',
    hero: 'split',
    postsLayout: 'mosaic',
    catalogLayout: 'list',
    accentLayout: 'gallery',
    rhythm: 'every3',
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'Minimal, quiet, gallery-clean.',
    bestFor: 'Any shop that loves less',
    palette: 'ivory',
    typography: 'modern',
    shape: 'soft',
    density: 'balanced',
    hero: 'minimal',
    postsLayout: 'grid',
    catalogLayout: 'cards',
    accentLayout: 'list',
    rhythm: 'uniform',
  },
  {
    id: 'noir',
    name: 'Noir',
    tagline: 'High contrast with a sharp attitude.',
    bestFor: 'Streetwear · barbers · nightlife',
    palette: 'mono',
    typography: 'display',
    shape: 'sharp',
    density: 'compact',
    hero: 'minimal',
    postsLayout: 'mosaic',
    catalogLayout: 'featured',
    accentLayout: 'compact',
    rhythm: 'uniform',
  },
  {
    id: 'bazaar',
    name: 'Bazaar',
    tagline: 'Vivid, handmade, full of life.',
    bestFor: 'Handmade · markets · variety',
    palette: 'clay',
    typography: 'warm',
    shape: 'soft',
    density: 'compact',
    hero: 'poster',
    postsLayout: 'masonry',
    catalogLayout: 'gallery',
    accentLayout: 'list',
    rhythm: 'every3',
  },
  {
    id: 'table',
    name: 'Table',
    tagline: 'A beautifully readable menu.',
    bestFor: 'Restaurants · bistros',
    palette: 'sand',
    typography: 'editorial',
    shape: 'soft',
    density: 'balanced',
    hero: 'classic',
    postsLayout: 'grid',
    catalogLayout: 'menu',
    accentLayout: 'cards',
    rhythm: 'every3',
  },
  {
    id: 'roast',
    name: 'Roast',
    tagline: 'Warm, cosy, made for coffee.',
    bestFor: 'Cafés · bakeries',
    palette: 'clay',
    typography: 'warm',
    shape: 'round',
    density: 'compact',
    hero: 'split',
    postsLayout: 'rail',
    catalogLayout: 'shelves',
    accentLayout: 'menu',
    rhythm: 'every3',
  },
  {
    id: 'fresh',
    name: 'Fresh',
    tagline: 'Bright, tidy, easy to shop.',
    bestFor: 'Groceries · organic · daily',
    palette: 'sage',
    typography: 'modern',
    shape: 'round',
    density: 'compact',
    hero: 'split',
    postsLayout: 'grid',
    catalogLayout: 'shelves',
    accentLayout: 'compact',
    rhythm: 'every2',
  },
  {
    id: 'arcade',
    name: 'Arcade',
    tagline: 'Bold type and a little drama.',
    bestFor: 'Services · events · entertainment',
    palette: 'night',
    typography: 'display',
    shape: 'sharp',
    density: 'balanced',
    hero: 'poster',
    postsLayout: 'rail',
    catalogLayout: 'cards',
    accentLayout: 'menu',
    rhythm: 'alternate',
  },
];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const defaultDesign: StoreDesign = {
  template: 'studio',
  palette: 'ivory',
  typography: 'modern',
  shape: 'soft',
  density: 'balanced',
  hero: 'classic',
  postsLayout: 'grid',
  catalogLayout: 'cards',
  accentLayout: 'list',
  rhythm: 'uniform',
  categoryLayouts: [],
  showProductImages: true,
  showProductDescriptions: true,
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * True when a row carries studio keys. Rows saved by older builds only hold
 * legacy color fields; those shops must keep the classic storefront instead of
 * suddenly rendering an empty default template.
 */
export function hasSavedDesign(settings?: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const value = settings as Record<string, unknown>;
  return (
    typeof value.template === 'string' ||
    typeof value.palette === 'string' ||
    typeof value.typography === 'string' ||
    typeof value.shape === 'string' ||
    typeof value.density === 'string' ||
    typeof value.hero === 'string' ||
    typeof value.postsLayout === 'string' ||
    typeof value.catalogLayout === 'string' ||
    typeof value.accentLayout === 'string' ||
    typeof value.rhythm === 'string' ||
    Array.isArray(value.categoryLayouts)
  );
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function categoryOverrides(
  value: DesignSettingsInput['categoryLayouts'],
): DesignCategoryLayout[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const overrides: DesignCategoryLayout[] = [];
  for (const entry of value) {
    const categoryId = entry?.categoryId;
    if (typeof categoryId !== 'string' || !uuidPattern.test(categoryId))
      continue;
    if (seen.has(categoryId)) continue;
    seen.add(categoryId);
    overrides.push({
      categoryId,
      layout: pick(entry?.layout, catalogLayouts, 'list'),
    });
    if (overrides.length >= 200) break;
  }
  return overrides;
}

/**
 * Turn whatever is stored in the JSON column into a complete design. Older
 * shops with no settings get the legacy storefront (callers check for null
 * first); malformed keys inside a saved row fall back one by one.
 */
export function normalizeDesign(
  settings?: DesignSettingsInput | null,
): StoreDesign {
  const raw = settings ?? {};
  return {
    template: pick(raw.template, designTemplates, defaultDesign.template),
    palette: pick(raw.palette, designPalettes, defaultDesign.palette),
    typography: pick(
      raw.typography,
      designTypographies,
      defaultDesign.typography,
    ),
    shape: pick(raw.shape, designShapes, defaultDesign.shape),
    density: pick(raw.density, designDensities, defaultDesign.density),
    hero: pick(raw.hero, designHeroes, defaultDesign.hero),
    postsLayout: pick(raw.postsLayout, postLayouts, defaultDesign.postsLayout),
    catalogLayout: pick(
      raw.catalogLayout,
      catalogLayouts,
      defaultDesign.catalogLayout,
    ),
    accentLayout: pick(
      raw.accentLayout,
      catalogLayouts,
      defaultDesign.accentLayout,
    ),
    rhythm: pick(raw.rhythm, designRhythms, defaultDesign.rhythm),
    categoryLayouts: categoryOverrides(raw.categoryLayouts),
    showProductImages: raw.showProductImages !== false,
    showProductDescriptions: raw.showProductDescriptions !== false,
  };
}

export function designPreset(id: DesignTemplate): DesignPreset {
  return designPresets.find((preset) => preset.id === id) ?? designPresets[0]!;
}

/**
 * Apply a starting point while keeping the owner's per-section overrides,
 * visibility choices and brand colour.
 */
export function designWithPreset(
  id: DesignTemplate,
  current?: StoreDesign,
): StoreDesign {
  const preset = designPreset(id);
  return {
    template: preset.id,
    palette: preset.palette,
    typography: preset.typography,
    shape: preset.shape,
    density: preset.density,
    hero: preset.hero,
    postsLayout: preset.postsLayout,
    catalogLayout: preset.catalogLayout,
    accentLayout: preset.accentLayout,
    rhythm: preset.rhythm,
    categoryLayouts: current?.categoryLayouts ?? [],
    showProductImages: current?.showProductImages ?? true,
    showProductDescriptions: current?.showProductDescriptions ?? true,
  };
}

/**
 * Resolve one section's layout. An explicit per-category choice always wins;
 * otherwise the rhythm decides between the primary and accent layout.
 */
export function resolveCategoryLayout(
  design: StoreDesign,
  index: number,
  categoryId?: string | null,
): CatalogLayout {
  const position = Number.isInteger(index) && index >= 0 ? index : 0;
  if (categoryId) {
    const override = design.categoryLayouts.find(
      (entry) => entry.categoryId === categoryId,
    );
    if (override) return override.layout;
  }
  const useAccent = (() => {
    switch (design.rhythm) {
      case 'alternate':
        return position % 2 === 1;
      case 'every2':
        return Math.floor(position / 2) % 2 === 1;
      case 'every3':
        return Math.floor(position / 3) % 2 === 1;
      default:
        return false;
    }
  })();
  return useAccent ? design.accentLayout : design.catalogLayout;
}

export function rhythmSummary(design: StoreDesign): string {
  const first = catalogLayoutInfo[design.catalogLayout].label;
  const second = catalogLayoutInfo[design.accentLayout].label;
  switch (design.rhythm) {
    case 'alternate':
      return `${first}, then ${second}, repeating`;
    case 'every2':
      return `${first} × 2, then ${second} × 2`;
    case 'every3':
      return `${first} × 3, then ${second} × 3`;
    case 'custom':
      return 'A layout chosen for each section';
    default:
      return `${first} in every section`;
  }
}

/** CSS custom properties consumed by the storefront stylesheets. */
export function designTheme(design: StoreDesign): Record<string, string> {
  const palette = paletteTokens[design.palette];
  const type = typographyTokens[design.typography];
  const shape = shapeTokens[design.shape];
  const density = densityTokens[design.density];
  return {
    '--brand-surface': palette.surface,
    '--brand-ink': palette.ink,
    '--brand-secondary': palette.accent,
    '--shop-font-display': type.display,
    '--shop-font-body': type.body,
    '--shop-display-weight': type.weight,
    '--shop-display-spacing': type.spacing,
    '--shop-radius': shape.radius,
    '--shop-tile-radius': shape.tile,
    '--shop-control-radius': shape.control,
    '--shop-section-gap': density.gap,
    '--shop-card-pad': density.pad,
  };
}

export function designSwatch(id: DesignTemplate): {
  surface: string;
  ink: string;
  accent: string;
} {
  const preset = designPreset(id);
  const palette = paletteTokens[preset.palette];
  return {
    surface: palette.surface,
    ink: palette.ink,
    accent: palette.accent,
  };
}

export function paletteChoices(): {
  key: DesignPalette;
  label: string;
  surface: string;
  ink: string;
  accent: string;
}[] {
  return designPalettes.map((key) => ({
    key,
    label: paletteTokens[key].label,
    surface: paletteTokens[key].surface,
    ink: paletteTokens[key].ink,
    accent: paletteTokens[key].accent,
  }));
}

export function typographyChoices(): {
  key: DesignTypography;
  label: string;
  display: string;
}[] {
  return designTypographies.map((key) => ({
    key,
    label: typographyTokens[key].label,
    display: typographyTokens[key].display,
  }));
}

export function shapeChoices(): {
  key: DesignShape;
  label: string;
  note: string;
  radius: string;
}[] {
  return designShapes.map((key) => ({
    key,
    label: shapeTokens[key].label,
    note: shapeTokens[key].note,
    radius: shapeTokens[key].radius,
  }));
}

export function densityChoices(): {
  key: DesignDensity;
  label: string;
  note: string;
}[] {
  return designDensities.map((key) => ({
    key,
    label: densityTokens[key].label,
    note: densityTokens[key].note,
  }));
}

export function heroChoices(): {
  key: DesignHero;
  label: string;
  hint: string;
}[] {
  return [
    {
      key: 'classic',
      label: 'Classic',
      hint: 'Cover photo with an overlapping logo.',
    },
    { key: 'split', label: 'Split', hint: 'Shorter cover, wider intro.' },
    { key: 'poster', label: 'Poster', hint: 'Name and logo over the cover.' },
    {
      key: 'minimal',
      label: 'Minimal',
      hint: 'A slim strip and quiet header.',
    },
    {
      key: 'immersive',
      label: 'Immersive',
      hint: 'Full-bleed, no frame at all.',
    },
  ];
}

/** Small helper so previews and the API can share the brand contrast rule. */
export function onBrandColor(primary: string): string {
  return contrastColor(primary);
}
