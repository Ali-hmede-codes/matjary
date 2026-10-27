import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  Palette,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react';
import type { StoreCategoryList } from '../../lib/api';
import {
  catalogLayoutInfo,
  catalogLayouts,
  designPresets,
  designPreset,
  designRhythms,
  designWithPreset,
  designSwatch,
  densityChoices,
  hasSavedDesign,
  heroChoices,
  normalizeDesign,
  paletteChoices,
  postLayoutInfo,
  postLayouts,
  resolveCategoryLayout,
  rhythmInfo,
  rhythmSummary,
  shapeChoices,
  typographyChoices,
  type CatalogLayout,
  type DesignPreset,
  type PostLayout,
  type StoreDesign,
} from '../../lib/design.ts';
import { storeMediaUrl, storePresentation } from '../../lib/storefront';
import { getJson, mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle, useUnsaved } from '../shared/PanelUI';
import { useOwner, type OwnerStore } from './OwnerPanel';

type WireBoxes = readonly (readonly [number, number, number, number])[];

// Small wireframes make a layout choice understandable before it is applied.
const postWires: Record<PostLayout, WireBoxes> = {
  grid: [
    [2, 2, 11, 11],
    [15, 2, 11, 11],
    [28, 2, 10, 11],
    [2, 15, 11, 11],
    [15, 15, 11, 11],
    [28, 15, 10, 11],
  ],
  masonry: [
    [2, 2, 11, 15],
    [15, 2, 11, 9],
    [28, 2, 10, 17],
    [2, 19, 11, 7],
    [15, 13, 11, 13],
    [28, 21, 10, 5],
  ],
  rail: [
    [1, 3, 12, 22],
    [15, 3, 12, 22],
    [29, 3, 10, 22],
  ],
  spotlight: [
    [2, 2, 20, 24],
    [24, 2, 14, 11],
    [24, 15, 14, 11],
  ],
  mosaic: [
    [2, 2, 20, 11],
    [24, 2, 14, 11],
    [2, 15, 11, 11],
    [15, 15, 9, 11],
    [24, 15, 14, 11],
  ],
  frames: [
    [3, 3, 10, 9],
    [15, 3, 10, 9],
    [27, 3, 10, 9],
    [3, 15, 10, 9],
    [15, 15, 10, 9],
    [27, 15, 10, 9],
  ],
};

const catalogWires: Record<CatalogLayout, WireBoxes> = {
  list: [
    [2, 3, 8, 8],
    [12, 4, 26, 2],
    [12, 8, 18, 2],
    [2, 15, 8, 8],
    [12, 16, 26, 2],
    [12, 20, 18, 2],
  ],
  cards: [
    [2, 2, 11, 11],
    [15, 2, 11, 11],
    [28, 2, 10, 11],
    [2, 15, 11, 11],
    [15, 15, 11, 11],
    [28, 15, 10, 11],
  ],
  compact: [
    [2, 4, 26, 2],
    [32, 4, 6, 2],
    [2, 10, 30, 2],
    [34, 10, 4, 2],
    [2, 16, 22, 2],
    [32, 16, 6, 2],
    [2, 22, 28, 2],
    [32, 22, 6, 2],
  ],
  menu: [
    [2, 4, 18, 2],
    [30, 4, 8, 2],
    [2, 8, 26, 1],
    [2, 13, 20, 2],
    [30, 13, 8, 2],
    [2, 17, 24, 1],
    [2, 22, 16, 2],
    [30, 22, 8, 2],
  ],
  gallery: [
    [2, 2, 11, 24],
    [15, 2, 11, 24],
    [28, 2, 10, 24],
  ],
  featured: [
    [2, 2, 36, 12],
    [2, 16, 8, 10],
    [12, 16, 8, 10],
    [22, 16, 7, 10],
    [31, 16, 7, 10],
  ],
  shelves: [
    [1, 4, 9, 20],
    [11, 4, 9, 20],
    [21, 4, 9, 20],
    [31, 4, 8, 20],
  ],
};

function LayoutWire({ boxes }: { boxes: WireBoxes }) {
  return (
    <svg
      className="layout-wire"
      viewBox="0 0 40 28"
      aria-hidden="true"
      focusable="false"
    >
      {boxes.map(([x, y, width, height], index) => (
        <rect key={index} x={x} y={y} width={width} height={height} rx={1.4} />
      ))}
    </svg>
  );
}

function StudioSection({
  step,
  title,
  hint,
  children,
  action,
}: {
  step: string;
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel-card design-card">
      <header className="design-card-head">
        <span className="design-step">{step}</span>
        <div>
          <h2>{title}</h2>
          {hint && <p className="panel-muted">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PresetArt({ preset }: { preset: DesignPreset }) {
  const swatch = designSwatch(preset.id);
  const typeface = typographyChoices().find(
    (entry) => entry.key === preset.typography,
  );
  return (
    <span
      className="design-preset-art"
      style={{ background: swatch.surface, color: swatch.ink }}
      aria-hidden="true"
    >
      <span
        className="design-preset-band"
        style={{ background: swatch.accent }}
      />
      <span
        className="design-preset-word"
        style={{ fontFamily: typeface?.display }}
      >
        {preset.name}
      </span>
      <span className="design-preset-tiles">
        <i style={{ background: swatch.accent }} />
        <i />
        <i />
      </span>
    </span>
  );
}

function LayoutPicker<T extends string>({
  label,
  hint,
  layouts,
  info,
  wires,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  layouts: readonly T[];
  info: Record<T, { label: string; hint: string }>;
  wires: Record<T, WireBoxes>;
  value: T;
  onChange: (layout: T) => void;
}) {
  return (
    <div className="design-layout-block">
      <div className="design-layout-heading">
        <strong>{label}</strong>
        <small className="panel-muted">{hint}</small>
      </div>
      <div className="design-layouts" role="group" aria-label={label}>
        {layouts.map((layout) => (
          <button
            key={layout}
            type="button"
            className={`design-layout ${value === layout ? 'is-selected' : ''}`}
            aria-pressed={value === layout}
            onClick={() => onChange(layout)}
          >
            <LayoutWire boxes={wires[layout]} />
            <strong>{info[layout].label}</strong>
            <small>{info[layout].hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function DesignStudio({ store }: { store: OwnerStore }) {
  const { session, savedStore } = useOwner();
  const [design, setDesign] = useState<StoreDesign>(() =>
    normalizeDesign(store.designSettings),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(normalizeDesign(store.designSettings)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const snapshot = JSON.stringify(design);
  const dirty = snapshot !== baseline;
  useUnsaved(dirty);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const categories = useQuery({
    queryKey: ['panel', session.user.id, 'design-categories', store.id],
    queryFn: ({ signal }) =>
      getJson<StoreCategoryList>(
        `stores/${encodeURIComponent(store.slug)}/categories`,
        signal,
      ),
    staleTime: 30_000,
  });
  const categoryItems = categories.data?.items ?? [];
  const overrideOf = (categoryId: string) =>
    design.categoryLayouts.find((entry) => entry.categoryId === categoryId)
      ?.layout ?? '';
  const staleOverrides = categories.isSuccess
    ? design.categoryLayouts.filter(
        (entry) =>
          !categoryItems.some((category) => category.id === entry.categoryId),
      ).length
    : 0;
  const preview = storePresentation({ ...store, designSettings: design });
  const preset = designPreset(design.template);
  const typography = typographyChoices();
  const palettes = paletteChoices();
  const shapes = shapeChoices();
  const densities = densityChoices();
  const heroes = heroChoices();

  const update = (patch: Partial<StoreDesign>) =>
    setDesign((current) => ({ ...current, ...patch }));

  function applyPreset(id: DesignPreset['id']) {
    setDesign((current) => designWithPreset(id, current));
  }

  function setCategoryLayout(categoryId: string, layout: CatalogLayout | '') {
    setDesign((current) => {
      const rest = current.categoryLayouts.filter(
        (entry) => entry.categoryId !== categoryId,
      );
      return {
        ...current,
        categoryLayouts: layout ? [...rest, { categoryId, layout }] : rest,
      };
    });
  }

  function undo() {
    setDesign(JSON.parse(baseline) as StoreDesign);
    setError('');
    setNotice('');
  }

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await mutate<OwnerStore>(
        `stores/${encodeURIComponent(store.slug)}`,
        { designSettings: design },
        'PATCH',
      );
      await savedStore(updated);
      const saved = normalizeDesign(updated.designSettings);
      setDesign(saved);
      setBaseline(JSON.stringify(saved));
      setNotice('Your design is live on your shop.');
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeDesign() {
    if (busy) return;
    if (
      !window.confirm(
        'Remove your custom design and return to the classic shop look?',
      )
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await mutate<OwnerStore>(
        `stores/${encodeURIComponent(store.slug)}`,
        { designSettings: null },
        'PATCH',
      );
      await savedStore(updated);
      const cleared = normalizeDesign(null);
      setDesign(cleared);
      setBaseline(JSON.stringify(cleared));
      setNotice('Back to the classic shop look.');
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="DESIGN STUDIO"
        title="Give your shop a signature."
        description="Pick a starting point, then tune every layout, type and colour. What you see is exactly what visitors get."
        action={
          store.status === 'active' && (
            <Link
              className="panel-secondary"
              to={`/stores/${store.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View my shop <ArrowUpRight size={16} />
            </Link>
          )
        }
      />
      {!hasSavedDesign(store.designSettings) && (
        <Notice>
          Your shop still has the classic look. Pick a starting point, tune it,
          then save to make this design live.
        </Notice>
      )}
      <div className="design-studio">
        <div className="design-studio-main">
          <StudioSection
            step="01"
            title="Start with a look"
            hint="Each look is a complete system: palette, type, corners, spacing, hero and layouts. Choosing one keeps your section styles and brand colour."
          >
            <div className="design-presets">
              {designPresets.map((entry) => {
                const selected = entry.id === design.template;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`design-preset ${selected ? 'is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => applyPreset(entry.id)}
                  >
                    <PresetArt preset={entry} />
                    <span className="design-preset-copy">
                      <strong>
                        {entry.name}
                        {selected && (
                          <span className="design-preset-check">
                            <Check size={13} />
                          </span>
                        )}
                      </strong>
                      <small>{entry.tagline}</small>
                      <em>{entry.bestFor}</em>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="design-fineprint panel-muted">
              <Sparkles size={14} /> Looks are a starting point, not a lock:
              every option below can be changed.
            </p>
          </StudioSection>

          <StudioSection
            step="02"
            title="Make it yours"
            hint="Your brand colour sets buttons and accents. The palette sets the page surface and ink."
            action={
              <Link className="design-inline-link" to="/dashboard/store">
                <Palette size={15} /> Brand colour & logo
              </Link>
            }
          >
            <div className="design-control-grid">
              <div className="design-control">
                <strong>Palette</strong>
                <div className="design-palettes">
                  {palettes.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-palette ${design.palette === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.palette === choice.key}
                      onClick={() => update({ palette: choice.key })}
                    >
                      <span
                        className="design-palette-swatch"
                        style={{
                          background: choice.surface,
                          borderColor: choice.ink,
                        }}
                      >
                        <i style={{ background: choice.accent }} />
                        <b style={{ background: choice.ink }} />
                      </span>
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="design-control">
                <strong>Type</strong>
                <div className="design-typefaces">
                  {typography.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-typeface ${design.typography === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.typography === choice.key}
                      onClick={() => update({ typography: choice.key })}
                    >
                      <span style={{ fontFamily: choice.display }}>Aa</span>
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="design-control">
                <strong>Corners</strong>
                <div className="design-shapes">
                  {shapes.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-shape ${design.shape === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.shape === choice.key}
                      onClick={() => update({ shape: choice.key })}
                      title={choice.note}
                    >
                      <i style={{ borderRadius: choice.radius }} />
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="design-control">
                <strong>Spacing</strong>
                <div className="design-shapes">
                  {densities.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-shape ${design.density === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.density === choice.key}
                      onClick={() => update({ density: choice.key })}
                      title={choice.note}
                    >
                      <i className={`design-density ${choice.key}`} />
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="design-control design-control-wide">
              <strong>Hero</strong>
              <div className="design-heroes">
                {heroes.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={`design-hero ${design.hero === choice.key ? 'is-selected' : ''}`}
                    aria-pressed={design.hero === choice.key}
                    onClick={() => update({ hero: choice.key })}
                  >
                    <span className={`design-hero-art is-${choice.key}`}>
                      <i />
                      <b />
                    </span>
                    <strong>{choice.label}</strong>
                    <small>{choice.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          </StudioSection>

          <StudioSection
            step="03"
            title="Posts"
            hint="The wall of photos and videos on your shop page."
          >
            <LayoutPicker
              label="Post layout"
              hint="Same posts, a different stage."
              layouts={postLayouts}
              info={postLayoutInfo}
              wires={postWires}
              value={design.postsLayout}
              onChange={(postsLayout) => update({ postsLayout })}
            />
          </StudioSection>

          <StudioSection
            step="04"
            title={preview.restaurant ? 'Menu' : 'Products'}
            hint="Choose the main item style and a second style for the section rhythm."
          >
            <LayoutPicker
              label="Main item style"
              hint="Used in every section unless a section overrides it."
              layouts={catalogLayouts}
              info={catalogLayoutInfo}
              wires={catalogWires}
              value={design.catalogLayout}
              onChange={(catalogLayout) => update({ catalogLayout })}
            />
            <div className="design-rhythm-head">
              <div>
                <strong>Section rhythm</strong>
                <small className="panel-muted">{rhythmSummary(design)}</small>
              </div>
              <label className="design-select">
                Second style
                <select
                  value={design.accentLayout}
                  onChange={(event) =>
                    update({
                      accentLayout: event.target.value as CatalogLayout,
                    })
                  }
                  disabled={design.rhythm === 'uniform'}
                >
                  {catalogLayouts.map((layout) => (
                    <option key={layout} value={layout}>
                      {catalogLayoutInfo[layout].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="design-rhythms"
              role="radiogroup"
              aria-label="Section rhythm"
            >
              {designRhythms.map((rhythm) => (
                <button
                  key={rhythm}
                  type="button"
                  role="radio"
                  aria-checked={design.rhythm === rhythm}
                  className={`design-rhythm ${design.rhythm === rhythm ? 'is-selected' : ''}`}
                  onClick={() => update({ rhythm })}
                >
                  <span className={`design-rhythm-art is-${rhythm}`}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{rhythmInfo[rhythm].label}</strong>
                  <small>{rhythmInfo[rhythm].hint}</small>
                </button>
              ))}
            </div>
            <div className="design-overrides">
              <div className="design-overrides-head">
                <div>
                  <strong>Section styles</strong>
                  <small className="panel-muted">
                    A section with its own style keeps it in every rhythm.
                  </small>
                </div>
                {design.categoryLayouts.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update({ categoryLayouts: [] })}
                  >
                    Clear all section styles
                  </button>
                )}
              </div>
              {categories.isPending ? (
                <p className="panel-muted">
                  <LoaderCircle className="spin" size={15} /> Loading your
                  sections…
                </p>
              ) : categories.isError ? (
                <Notice error>
                  Your sections could not load.{' '}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void categories.refetch()}
                  >
                    Try again
                  </button>
                </Notice>
              ) : categoryItems.length === 0 ? (
                <p className="panel-muted">
                  No sections yet. Add them when you create your{' '}
                  <Link to="/dashboard/products">
                    {preview.restaurant ? 'menu' : 'products'}
                  </Link>
                  , then come back to style each one.
                </p>
              ) : (
                <ul className="design-section-list">
                  {categoryItems.map((category, index) => {
                    const effective = resolveCategoryLayout(
                      design,
                      index,
                      category.id,
                    );
                    return (
                      <li key={category.id}>
                        <div className="design-section-copy">
                          <strong>{category.name}</strong>
                          <small>
                            {category.productCount ?? 0}{' '}
                            {(category.productCount ?? 0) === 1
                              ? 'item'
                              : 'items'}{' '}
                            · showing {catalogLayoutInfo[effective].label}
                          </small>
                        </div>
                        <select
                          aria-label={`Layout for ${category.name}`}
                          value={overrideOf(category.id)}
                          onChange={(event) =>
                            setCategoryLayout(
                              category.id,
                              event.target.value as CatalogLayout | '',
                            )
                          }
                        >
                          <option value="">Follow the rhythm</option>
                          {catalogLayouts.map((layout) => (
                            <option key={layout} value={layout}>
                              {catalogLayoutInfo[layout].label}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
              {staleOverrides > 0 && (
                <p className="panel-muted design-fineprint">
                  {staleOverrides}{' '}
                  {staleOverrides === 1
                    ? 'saved style belongs'
                    : 'saved styles belong'}{' '}
                  to a section that no longer exists. It will be cleaned up when
                  you save.
                </p>
              )}
            </div>
          </StudioSection>

          <StudioSection
            step="05"
            title="Finishing touches"
            hint="Less can be more. These choices apply to every item layout."
          >
            <div className="design-toggles">
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={design.showProductImages}
                  onChange={(event) =>
                    update({ showProductImages: event.target.checked })
                  }
                />
                Show product photos
                <small>
                  When off, image-led layouts become a clean price list.
                </small>
              </label>
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={design.showProductDescriptions}
                  onChange={(event) =>
                    update({ showProductDescriptions: event.target.checked })
                  }
                />
                Show product descriptions
                <small>
                  Hide ingredient or detail text for a lighter menu.
                </small>
              </label>
            </div>
          </StudioSection>

          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
        </div>

        <aside className="design-studio-preview">
          <p className="panel-eyebrow">LIVE PREVIEW</p>
          <div
            className="design-preview"
            style={preview.theme as CSSProperties}
          >
            <div className={`design-preview-hero is-${design.hero}`}>
              <span className="design-preview-cover" />
              <span className="design-preview-logo">
                {store.logoKey ? (
                  <img src={storeMediaUrl(store.logoKey)} alt="" />
                ) : (
                  (store.name.trim()[0] || 'M').toUpperCase()
                )}
              </span>
              <span className="design-preview-id">
                <strong style={{ fontFamily: 'var(--shop-font-display)' }}>
                  {store.name}
                </strong>
                <small>
                  {store.businessCategoryLabel ||
                    (preview.restaurant
                      ? 'Restaurant & café'
                      : 'Independent shop')}
                </small>
              </span>
            </div>
            <div className="design-preview-body">
              <div className="design-preview-tabs">
                <span className="is-active">Posts</span>
                <span>{preview.restaurant ? 'Menu' : 'Shop'}</span>
              </div>
              <div
                className={`design-preview-wall is-${design.postsLayout}`}
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <i key={index} />
                ))}
              </div>
              <div
                className={`design-preview-items is-${displayLayout(design)}`}
                aria-hidden="true"
              >
                {[0, 1, 2, 3].map((index) => (
                  <i key={index}>
                    <b />
                    <span />
                  </i>
                ))}
              </div>
            </div>
          </div>
          <p className="design-preview-caption">
            <Wand2 size={14} />
            <span>
              {preset.name} · {rhythmSummary(design)}
            </span>
          </p>
          <div className="panel-save-bar design-save-bar">
            <span>
              {dirty ? 'You have unsaved changes' : 'Everything is up to date'}
            </span>
            <div className="design-save-actions">
              <button
                type="button"
                className="panel-secondary"
                onClick={undo}
                disabled={!dirty || busy}
              >
                <Undo2 size={15} /> Undo
              </button>
              <button
                type="button"
                className="panel-primary"
                onClick={() => void save()}
                disabled={!dirty || busy}
              >
                {busy ? 'Saving…' : 'Save design'}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="design-remove"
            onClick={() => void removeDesign()}
            disabled={busy}
          >
            Remove custom design
          </button>
        </aside>
      </div>
    </>
  );
}

// The preview uses the first section's resolved layout so a rhythm is visible.
function displayLayout(design: StoreDesign): CatalogLayout {
  return resolveCategoryLayout(design, 0);
}

export function StoreDesignStudio() {
  const { store } = useOwner();
  if (!store) return null;
  return <DesignStudio key={store.id} store={store} />;
}
