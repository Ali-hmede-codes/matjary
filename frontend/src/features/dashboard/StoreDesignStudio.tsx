import './StoreDesignStudio.css';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  ChevronDown,
  Eye,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Palette,
  Ruler,
  SlidersHorizontal,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react';
import {
  catalogLayoutGroupInfo,
  catalogLayoutGroupOf,
  catalogLayoutGroups,
  catalogLayoutInfo,
  catalogLayouts,
  coverShapeChoices,
  designRhythms,
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
  type PostLayout,
  type StoreDesign,
} from '../../lib/design.ts';
import {
  storeMediaUrl,
  storePath,
  storePresentation,
} from '../../lib/storefront';
import { mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle, useUnsaved } from '../shared/PanelUI';
import { SettingsJump, SettingsSection } from '../shared/SettingsSections';
import { CoverEdge } from '../../components/CoverEdge';
import { catalogGrid } from '../../components/catalog';
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
  modular: [
    [2, 2, 18, 18],
    [22, 2, 17, 8],
    [22, 12, 8, 8],
    [31, 12, 8, 8],
  ],
  frames: [
    [3, 3, 10, 9],
    [15, 3, 10, 9],
    [27, 3, 10, 9],
    [3, 15, 10, 9],
    [15, 15, 10, 9],
    [27, 15, 10, 9],
  ],
  wall: [
    [1, 1, 9, 8],
    [11, 1, 9, 8],
    [21, 1, 9, 8],
    [31, 1, 8, 8],
    [1, 10, 9, 8],
    [11, 10, 9, 8],
    [21, 10, 9, 8],
    [31, 10, 8, 8],
    [1, 19, 9, 8],
    [11, 19, 9, 8],
    [21, 19, 9, 8],
    [31, 19, 8, 8],
  ],
  list: [
    [2, 3, 7, 7],
    [11, 4, 26, 2],
    [11, 8, 16, 2],
    [2, 13, 7, 7],
    [11, 14, 26, 2],
    [11, 18, 16, 2],
    [2, 23, 7, 3],
  ],
  stack: [
    [2, 2, 36, 10],
    [2, 14, 36, 10],
  ],
  rows: [
    [2, 2, 36, 6],
    [2, 11, 36, 6],
    [2, 20, 36, 6],
  ],
  cover: [
    [2, 2, 36, 12],
    [2, 16, 8, 10],
    [12, 16, 8, 10],
    [22, 16, 7, 10],
    [31, 16, 7, 10],
  ],
  tiles: [
    [2, 2, 11, 8],
    [15, 2, 11, 8],
    [28, 2, 10, 8],
    [2, 14, 11, 8],
    [15, 14, 11, 8],
    [28, 14, 10, 8],
  ],
  reel: [
    [1, 6, 13, 10],
    [16, 6, 13, 10],
    [31, 6, 7, 10],
  ],
  stagger: [
    [2, 2, 11, 8],
    [15, 6, 11, 8],
    [28, 2, 10, 8],
    [2, 15, 11, 8],
    [15, 19, 11, 8],
    [28, 15, 10, 8],
  ],
  drift: [
    [1, 9, 11, 8],
    [14, 9, 11, 8],
    [27, 9, 11, 8],
    [40, 9, 4, 8],
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
  id,
  step,
  icon,
  title,
  hint,
  children,
}: {
  id: string;
  step: string;
  icon: typeof Palette;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      id={id}
      step={step}
      icon={icon}
      title={title}
      hint={hint}
      className="design-card"
    >
      {children}
    </SettingsSection>
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
            aria-label={`${info[layout].label}: ${info[layout].hint}`}
            title={info[layout].hint}
            onClick={() => onChange(layout)}
          >
            <LayoutWire boxes={wires[layout]} />
            <strong>{info[layout].label}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One "Layout 1/2/3" slot: a tiny wireframe plus the layout select. */
function LayoutSlot({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CatalogLayout;
  onChange: (layout: CatalogLayout) => void;
}) {
  return (
    <label className="design-slot">
      <span>{label}</span>
      <span className="design-slot-row">
        <LayoutWire boxes={catalogGrid(value).wire} />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as CatalogLayout)}
        >
          {catalogLayoutGroups.map((group) => (
            <optgroup
              key={group}
              label={catalogLayoutGroupInfo[group].label}
              title={catalogLayoutGroupInfo[group].hint}
            >
              {catalogLayouts
                .filter((layout) => catalogLayoutGroupOf[layout] === group)
                .map((layout) => (
                  <option key={layout} value={layout}>
                    {catalogLayoutInfo[layout].label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </span>
    </label>
  );
}

function DesignStudio({ store }: { store: OwnerStore }) {
  const { savedStore } = useOwner();
  const [design, setDesign] = useState<StoreDesign>(() =>
    normalizeDesign(store.designSettings),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(normalizeDesign(store.designSettings)),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const preview = storePresentation({ ...store, designSettings: design });
  const typography = typographyChoices();
  const palettes = paletteChoices();
  const shapes = shapeChoices();
  const densities = densityChoices();
  const heroes = heroChoices();
  const coverStyles = coverShapeChoices();
  const advancedSummary = `${
    heroes.find((entry) => entry.key === design.hero)?.label ?? 'Classic'
  } cover · ${rhythmSummary(design)}`;
  // Very tall layouts get fewer preview tiles so the preview stays compact.
  const previewTiles =
    design.postsLayout === 'stack'
      ? 2
      : design.postsLayout === 'rows'
        ? 3
        : design.postsLayout === 'modular' ||
            design.postsLayout === 'cover' ||
            design.postsLayout === 'list'
          ? 4
          : 6;

  const update = (patch: Partial<StoreDesign>) =>
    setDesign((current) => ({ ...current, ...patch }));

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
      setNotice('Saved. Your shop now uses this design.');
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
        eyebrow="SHOP DESIGN"
        title="Choose your layouts."
        description="Fine-tune the posts, sections, colors and type of your shop."
        action={
          store.status === 'active' && (
            <Link
              className="panel-secondary"
              to={storePath(store.slug)}
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
          Your shop still has the classic look. Choose your layouts, then press
          Save to make them live.
        </Notice>
      )}
      <div className="design-studio">
        <div className="design-studio-main">
          <SettingsJump
            label="Jump to a design step"
            items={[
              { id: 'design-posts', label: 'Post layout', icon: LayoutGrid },
              { id: 'design-sections', label: 'Sections', icon: Layers },
              { id: 'design-style', label: 'Colours & type', icon: Type },
              {
                id: 'design-advanced',
                label: 'Advanced',
                icon: SlidersHorizontal,
              },
            ]}
          />
          <StudioSection
            id="design-posts"
            step="01"
            icon={LayoutGrid}
            title="Post layout"
            hint={`${postLayouts.length} arrangements. Pick the one that fits your shop.`}
          >
            <LayoutPicker
              label="Posts"
              hint="Tap a layout to use it."
              layouts={postLayouts}
              info={postLayoutInfo}
              wires={postWires}
              value={design.postsLayout}
              onChange={(postsLayout) => update({ postsLayout })}
            />
          </StudioSection>

          <StudioSection
            id="design-sections"
            step="02"
            icon={Layers}
            title={preview.restaurant ? 'Menu sections' : 'Product sections'}
            hint="Choose one layout for every section, or repeat two or three layouts."
          >
            <div
              className="design-pattern-options"
              role="radiogroup"
              aria-label="Section rhythm"
            >
              {designRhythms.map((rhythm) => (
                <button
                  key={rhythm}
                  type="button"
                  role="radio"
                  aria-checked={design.rhythm === rhythm}
                  className={`design-pattern ${design.rhythm === rhythm ? 'is-selected' : ''}`}
                  onClick={() => update({ rhythm })}
                >
                  <span className={`design-pattern-art is-${rhythm}`}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{rhythmInfo[rhythm].label}</strong>
                  <small>{rhythmInfo[rhythm].hint}</small>
                </button>
              ))}
            </div>
            <div className="design-slots">
              <LayoutSlot
                label="Layout 1"
                value={design.catalogLayout}
                onChange={(catalogLayout) => update({ catalogLayout })}
              />
              {design.rhythm !== 'same' && (
                <LayoutSlot
                  label="Layout 2"
                  value={design.accentLayout}
                  onChange={(accentLayout) => update({ accentLayout })}
                />
              )}
              {design.rhythm === 'repeat3' && (
                <LayoutSlot
                  label="Layout 3"
                  value={design.thirdLayout}
                  onChange={(thirdLayout) => update({ thirdLayout })}
                />
              )}
            </div>
            <p className="design-slot-legend">
              {catalogLayoutGroups.map((group) => (
                <span key={group}>
                  <strong>{catalogLayoutGroupInfo[group].label}</strong>{' '}
                  {catalogLayoutGroupInfo[group].hint}
                </span>
              ))}
            </p>
            <p className="design-fineprint panel-muted">
              <Wand2 size={13} /> {rhythmSummary(design)}
            </p>
          </StudioSection>

          <StudioSection
            id="design-style"
            step="03"
            icon={Type}
            title="Colors & type"
            hint="Keep it simple: one palette, one type."
          >
            <div className="design-quick-grid">
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
            </div>
            <p className="design-fineprint panel-muted">
              <Palette size={13} /> Main colour and logo live in{' '}
              <Link to="/dashboard/store">Store editor</Link>.
            </p>
          </StudioSection>

          <details
            id="design-advanced"
            className="panel-card design-advanced"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="design-advanced-title">
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span>
                  <strong>Advanced</strong>
                  <small>{advancedSummary}</small>
                </span>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="design-advanced-body">
              <div className="design-advanced-block">
                <h3>
                  <ImageIcon size={13} aria-hidden="true" /> Cover layout
                </h3>
                <div className="design-heroes">
                  {heroes.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-hero ${design.hero === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.hero === choice.key}
                      title={choice.hint}
                      onClick={() => update({ hero: choice.key })}
                    >
                      <span className={`design-hero-art is-${choice.key}`}>
                        <i />
                        <b />
                      </span>
                      <strong>{choice.label}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="design-advanced-block">
                <h3>
                  <Wand2 size={13} aria-hidden="true" /> Cover style
                </h3>
                <div
                  className="design-cover-shapes"
                  role="group"
                  aria-label="Cover style"
                >
                  {coverStyles.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={`design-cover-shape ${design.coverShape === choice.key ? 'is-selected' : ''}`}
                      aria-pressed={design.coverShape === choice.key}
                      aria-label={`${choice.label}: ${choice.hint}`}
                      title={choice.hint}
                      onClick={() => update({ coverShape: choice.key })}
                    >
                      <span
                        className="design-cover-shape-art"
                        aria-hidden="true"
                      >
                        <CoverEdge shape={choice.key} />
                      </span>
                      <strong>{choice.label}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="design-advanced-block">
                <h3>
                  <Ruler size={13} aria-hidden="true" /> Spacing & corners
                </h3>
                <div className="design-control-grid">
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
              </div>

              <div className="design-advanced-block">
                <h3>
                  <Eye size={13} aria-hidden="true" /> Product details
                </h3>
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
                  </label>
                  <label className="panel-toggle">
                    <input
                      type="checkbox"
                      checked={design.showProductDescriptions}
                      onChange={(event) =>
                        update({
                          showProductDescriptions: event.target.checked,
                        })
                      }
                    />
                    Show product descriptions
                  </label>
                </div>
              </div>
            </div>
          </details>

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
              <span className="design-preview-cover">
                <CoverEdge shape={design.coverShape} />
              </span>
              <span className="design-preview-logo">
                {store.logoKey ? (
                  <img src={storeMediaUrl(store.logoKey)} alt="" />
                ) : (
                  (store.name.trim()[0] || 'M').toUpperCase()
                )}
              </span>
              <span className="design-preview-id">
                <strong
                  className="notranslate"
                  style={{ fontFamily: 'var(--shop-font-display)' }}
                >
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
                {Array.from({ length: previewTiles }, (_, index) => (
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
            <Wand2 size={13} />
            <span>
              {postLayoutInfo[design.postsLayout].label} posts ·{' '}
              {rhythmSummary(design)}
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
      {dirty && (
        <div
          className="design-mobile-save"
          role="region"
          aria-label="Unsaved design changes"
        >
          <span>Unsaved changes</span>
          <button
            type="button"
            className="panel-secondary"
            onClick={undo}
            disabled={busy}
          >
            Undo
          </button>
          <button
            type="button"
            className="panel-primary"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </>
  );
}

// The preview uses the first section's resolved layout, so a repeat is visible.
function displayLayout(design: StoreDesign): CatalogLayout {
  return resolveCategoryLayout(design, 0);
}

export function StoreDesignStudio() {
  const { store } = useOwner();
  if (!store) return null;
  return <DesignStudio key={store.id} store={store} />;
}
