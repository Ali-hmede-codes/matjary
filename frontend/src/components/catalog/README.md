# Product-section grids

Every storefront product section renders one grid from this folder. A grid is a
self-contained unit: its metadata, its preview geometry, its markup and its
stylesheet live together, and exactly one registry line connects it to the
storefront.

```
catalog/
├─ index.ts            public API: CatalogItems, CatalogLoading, ShopImage, AddToCart
├─ CatalogItems.tsx    resolves the saved key, renders that grid
├─ CatalogLoading.tsx  draws the grid's own loading skeleton
├─ registry.tsx        the one place that knows every grid (Record<CatalogLayout, CatalogGrid>)
├─ types.ts            CatalogGrid contract: key, wire, skeleton, imageLed, Grid
├─ primitives.tsx      photo, cart control, badges, price block, caption slots
├─ catalog.css         shared frame, pill and skeleton rules
├─ shared/             cards reused by more than one grid
│  ├─ photo-card.*     square / portrait / wide box (cards, gallery, featured, shelves)
│  ├─ tile-card.*      4:3 photo card (tiles, bento, sticker, circles, rail)
│  ├─ banner-card.*    cover card (banner, cover)
│  ├─ price-line.*     text-only price row (compact, menu)
│  ├─ item-caption.*   caption block used by tile-card and zigzag
│  └─ shelf-rail.*     the sideways strip and its arrows
└─ layouts/            one file per grid, in the studio's order
   ├─ list.tsx + list.css
   ├─ cards.tsx + cards.css
   ├─ compact.tsx + compact.css
   ├─ menu.tsx + menu.css
   ├─ gallery.tsx + gallery.css
   ├─ featured.tsx + featured.css
   ├─ shelves.tsx + shelves.css
   ├─ overlay.tsx + overlay.css
   ├─ tiles.tsx + tiles.css
   ├─ bento.tsx + bento.css
   ├─ sticker.tsx + sticker.css
   ├─ circles.tsx + circles.css
   ├─ rail.tsx + rail.css
   ├─ ribbon.tsx + ribbon.css
   ├─ zigzag.tsx + zigzag.css
   ├─ numbered.tsx + numbered.css   (saved key: `index`)
   ├─ rows.tsx + rows.css
   ├─ banner.tsx + banner.css
   └─ cover.tsx + cover.css
```

## Add a grid

1. Add the key to `src/lib/catalog-layouts.ts` (`catalogLayouts`) and its
   label/hint/group to the maps in the same file.
2. Add the same key to `backend/apps/api/src/modules/stores/dto/store-design.dto.ts`
   (`DESIGN_CATALOG_LAYOUT_KEYS`). Unknown keys are rejected at the API boundary.
3. Create `layouts/<key>.tsx`. It exports one `CatalogGrid`:

   ```tsx
   export const myGrid: CatalogGrid = {
     key: 'myGrid',
     wire: [[2, 2, 11, 8]], // studio preview, 40 x 28 viewBox
     skeleton: { shape: 'card', rows: 6, frame: 'layout-myGrid' },
     imageLed: true, // falls back to `compact` when photos are hidden
     Grid: MyGrid,
   };
   ```

   Reuse `PhotoCard`, `TileCard`, `BannerCard`, `PriceLine`, `ShelfRail` and the
   `primitives` where possible; only the arrangement should be new.

4. Create `layouts/<key>.css`. Scope every rule under the grid's own class
   (`.shop-catalog-items.layout-myGrid` or the card class it owns).
5. Register the grid in `registry.tsx` (one import + one entry) and append its
   stylesheet to the catalog block of `src/components/storefront.css`.

TypeScript fails if the registry misses a catalogue key or holds a key that no
longer exists, so the storefront can never render a blank section.

## Remove a grid

Delete its `layouts/<key>.*` files, its registry entry, its `@import` line in
`storefront.css`, its key/label/group from `catalog-layouts.ts` and from the
backend DTO. Shared cards stay for the grids that still use them.

## Preview every grid (dev only)

Run `npm run dev`, then open
[http://127.0.0.1:5173/catalog-preview.html](http://127.0.0.1:5173/catalog-preview.html).

Every grid is shown in a 390px phone frame and a 1280px desktop frame, with one
and with six mock products (sale, sold out, low stock, options and a long name),
so a change can be judged in the states that break instead of one tidy row.

- `?layouts=zigzag,index,rows` narrows the bench to a few grids.
- `&count=1,6` picks the product counts (up to four).
- `&incart=1` puts the first product in the cart, to check the quantity stepper.
- An embed accepts `&dir=rtl` for Arabic shops.

Each frame is a real iframe (`catalog-preview.html?embed=1&layout=…`) because the
grids switch on viewport media queries, not container queries. The page is not a
Vite build entry, so it never ships; its mock data lives in
`src/catalog-preview/`, its placeholder photos in `catalog-preview-assets/`.

## Why the CSS is listed in `storefront.css`

The catalog styles are part of one ordered stylesheet with the rest of the
storefront. Importing CSS from the components would split it across lazy chunks
and make the cascade depend on which chunk loaded first; the single ordered list
in `storefront.css` keeps it deterministic (base primitives → shared cards →
one file per grid, in registry order).

Saved designs use keys from `src/lib/catalog-layouts.ts`. A missing or unknown
key falls back to a default during `normalizeDesign`, so removing a grid never
breaks a shop that already saved it.
