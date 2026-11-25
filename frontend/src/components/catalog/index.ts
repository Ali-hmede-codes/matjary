// Public surface of the product-section catalogue. Consumers import from here;
// the registry and the individual grid files stay internal so a grid can be
// added or removed without touching a call site.
export { CatalogItems } from './CatalogItems';
export { CatalogLoading } from './CatalogLoading';
export { AddToCart, ShopImage } from './primitives';
export { catalogGrid, catalogGrids } from './registry';
export type { CatalogGrid } from './types';
