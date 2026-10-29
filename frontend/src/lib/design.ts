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
  'pulse',
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
  'wall',
  'list',
  'stack',
  'cover',
  'tiles',
  'reel',
  'stagger',
  'drift',
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
  'overlay',
  'tiles',
  'bento',
  'stagger',
  'sticker',
  'circles',
  'rail',
  'ribbon',
  'zigzag',
  'index',
  'rows',
  'banner',
  'cover',
] as const;
export type CatalogLayout = (typeof catalogLayouts)[number];

// Section rhythm is deliberately simple: one style everywhere, or a repeating
// group of two or three styles.
export const designRhythms = ['same', 'repeat2', 'repeat3'] as const;
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
  thirdLayout?: string | null;
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
  thirdLayout: CatalogLayout;
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
  grid: { label: 'Grid', hint: 'Even, clean portrait tiles.' },
  masonry: { label: 'Masonry', hint: 'Mixed heights, gallery flow.' },
  rail: { label: 'Rail', hint: 'A swipeable strip of posts.' },
  spotlight: {
    label: 'Spotlight',
    hint: 'The newest post gets a double frame.',
  },
  mosaic: { label: 'Mosaic', hint: 'Bold mixed-size collage.' },
  frames: { label: 'Frames', hint: 'Framed, spaced-out gallery prints.' },
  wall: { label: 'Wall', hint: 'Dense square tiles, edge to edge.' },
  list: { label: 'List', hint: 'Rows with a thumbnail and the post title.' },
  stack: { label: 'Stack', hint: 'One full-width post after another.' },
  cover: { label: 'Cover', hint: 'A full-width cover post, then a grid.' },
  tiles: {
    label: 'Photo tiles',
    hint: 'Full 4:3 photos in a tidy, compact grid.',
  },
  reel: {
    label: 'Reel',
    hint: 'A 4:3 strip that scrolls sideways.',
  },
  stagger: {
    label: 'Staggered',
    hint: '4:3 tiles with an offset, editorial rhythm.',
  },
  drift: {
    label: 'Drift',
    hint: 'A 4:3 strip that drifts on its own. Hover or pause to stop it.',
  },
};

export const catalogLayoutInfo: Record<
  CatalogLayout,
  { label: string; hint: string }
> = {
  list: { label: 'Classic rows', hint: 'Photo, name, description, price.' },
  cards: {
    label: 'Square grid',
    hint: '1:1 card boxes, name and price inside the box.',
  },
  compact: { label: 'Price list', hint: 'Fast to scan, no photos.' },
  menu: { label: 'Menu', hint: 'Dotted prices, editorial feel.' },
  gallery: {
    label: 'Portrait grid',
    hint: '3:4 card boxes, copy inside the box.',
  },
  featured: {
    label: 'Wide feature',
    hint: '4:3 landscape card boxes, two per row.',
  },
  shelves: {
    label: 'Sideways rail',
    hint: '1:1 card boxes that scroll left to right.',
  },
  overlay: {
    label: 'Photo overlay',
    hint: 'Full 4:3 photos with a glass name and price.',
  },
  tiles: {
    label: 'Photo tiles',
    hint: '4:3 photos with a quiet caption below.',
  },
  bento: {
    label: 'Bento',
    hint: '4:3 photos in a mixed grid with one wide tile.',
  },
  stagger: {
    label: 'Staggered',
    hint: '4:3 photos on an offset, editorial rhythm.',
  },
  sticker: {
    label: 'Sticker',
    hint: 'A caption card overlapping each 4:3 photo.',
  },
  circles: {
    label: 'Circles',
    hint: 'Round photos with the name underneath.',
  },
  rail: {
    label: 'Photo rail',
    hint: 'A 4:3 strip that snaps sideways.',
  },
  ribbon: {
    label: 'Ribbon',
    hint: 'A 4:3 strip that drifts on its own.',
  },
  zigzag: {
    label: 'Zigzag',
    hint: 'Photo and text rows that alternate sides.',
  },
  index: {
    label: 'Numbered',
    hint: 'An editorial list with big index numbers.',
  },
  rows: {
    label: 'Photo menu',
    hint: 'Thin rows with a small 4:3 photo and dotted prices.',
  },
  banner: {
    label: 'Banner card',
    hint: 'A wide cover with a floating tile, scrolled sideways.',
  },
  cover: {
    label: 'Cover card',
    hint: 'The same card without the floating tile.',
  },
};

export const rhythmInfo: Record<DesignRhythm, { label: string; hint: string }> =
  {
    same: {
      label: 'All sections same',
      hint: 'Every section uses layout 1.',
    },
    repeat2: {
      label: '2 layouts repeating',
      hint: 'Layout 1, layout 2, then repeat.',
    },
    repeat3: {
      label: '3 layouts repeating',
      hint: 'Layout 1, 2, 3, then repeat.',
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
  thirdLayout: CatalogLayout;
  rhythm: DesignRhythm;
}

// Twelve starting points, each a complete system rather than a colour swap.
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
    thirdLayout: 'cards',
    rhythm: 'repeat2',
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
    thirdLayout: 'list',
    rhythm: 'repeat2',
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
    thirdLayout: 'featured',
    rhythm: 'repeat2',
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
    thirdLayout: 'menu',
    rhythm: 'repeat3',
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
    thirdLayout: 'gallery',
    rhythm: 'same',
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
    thirdLayout: 'list',
    rhythm: 'same',
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
    thirdLayout: 'shelves',
    rhythm: 'repeat3',
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
    thirdLayout: 'compact',
    rhythm: 'repeat3',
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
    thirdLayout: 'cards',
    rhythm: 'repeat3',
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
    postsLayout: 'tiles',
    catalogLayout: 'shelves',
    accentLayout: 'compact',
    thirdLayout: 'cards',
    rhythm: 'repeat2',
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
    postsLayout: 'reel',
    catalogLayout: 'cards',
    accentLayout: 'menu',
    thirdLayout: 'gallery',
    rhythm: 'repeat2',
  },
  {
    id: 'pulse',
    name: 'Pulse',
    tagline: 'A quiet 4:3 window that keeps moving.',
    bestFor: 'Drops · streetwear · coffee',
    palette: 'ocean',
    typography: 'modern',
    shape: 'round',
    density: 'compact',
    hero: 'minimal',
    postsLayout: 'drift',
    catalogLayout: 'cards',
    accentLayout: 'compact',
    thirdLayout: 'featured',
    rhythm: 'repeat2',
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
  thirdLayout: 'gallery',
  rhythm: 'same',
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
 * The earlier studio stored `alternate`, `every2`, `every3`, `uniform` and
 * `custom`. Map those rows onto the simple "same / repeat 2 / repeat 3" model;
 * anything that used two styles keeps repeating those two.
 */
function normalizedRhythm(value: unknown): DesignRhythm {
  if (value === 'same' || value === 'repeat2' || value === 'repeat3')
    return value;
  if (value === 'alternate' || value === 'every2' || value === 'every3')
    return 'repeat2';
  return defaultDesign.rhythm;
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
    thirdLayout: pick(
      raw.thirdLayout,
      catalogLayouts,
      defaultDesign.thirdLayout,
    ),
    rhythm: normalizedRhythm(raw.rhythm),
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
    thirdLayout: preset.thirdLayout,
    rhythm: preset.rhythm,
    categoryLayouts: current?.categoryLayouts ?? [],
    showProductImages: current?.showProductImages ?? true,
    showProductDescriptions: current?.showProductDescriptions ?? true,
  };
}

/**
 * Resolve one section's layout. An explicit per-category choice always wins;
 * otherwise the simple rhythm decides: one layout everywhere, or a repeating
 * pair/triple of layouts.
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
  if (design.rhythm === 'repeat2')
    return position % 2 === 1 ? design.accentLayout : design.catalogLayout;
  if (design.rhythm === 'repeat3') {
    const sequence = [
      design.catalogLayout,
      design.accentLayout,
      design.thirdLayout,
    ];
    return sequence[position % 3] ?? design.catalogLayout;
  }
  return design.catalogLayout;
}

export function rhythmSummary(design: StoreDesign): string {
  const first = catalogLayoutInfo[design.catalogLayout].label;
  const second = catalogLayoutInfo[design.accentLayout].label;
  const third = catalogLayoutInfo[design.thirdLayout].label;
  if (design.rhythm === 'repeat2') return `${first} → ${second}, repeating`;
  if (design.rhythm === 'repeat3')
    return `${first} → ${second} → ${third}, repeating`;
  return `${first} in every section`;
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
