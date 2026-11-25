import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  categoryIndexStyleInfo,
  categoryIndexStyles,
  designTheme,
  normalizeDesign,
  paletteChoices,
  type CategoryIndexStyle,
  type DesignPalette,
} from '../lib/design';
import type { MenuCategoryGroup } from '../lib/storefront';
import { CategoryShowcase } from '../components/CategoryShowcase';
import badminton from './assets/badminton-photo.jpg';
import boxing from './assets/boxing-photo.jpg';
import dumbbells from './assets/dumbbells-photo.jpg';
import payPerClick from './assets/pay-per-click-photo.jpg';
import referenceDark from './assets/reference-dark.jpg';
import referenceLight from './assets/reference-light.jpg';
import searchEngine from './assets/search-engine-photo.jpg';
import socialMedia from './assets/social-media-photo.jpg';
import tennis from './assets/tennis-photo.jpg';
import videoProduction from './assets/video-production-photo.jpg';

// The eight pictures are cropped from the two reference boards, so the bench
// judges the card design with the same kind of product photography the owner
// will paste as a PNG/JPG link.
const samples: MenuCategoryGroup[] = [
  {
    key: 'video',
    name: 'Video Production',
    count: 12,
    imageUrl: videoProduction,
  },
  {
    key: 'ppc',
    name: 'Pay-per-click advertising',
    count: 8,
    imageUrl: payPerClick,
  },
  {
    key: 'social',
    name: 'Social Media Marketing',
    count: 16,
    imageUrl: socialMedia,
  },
  {
    key: 'seo',
    name: 'Search engine optimization',
    count: 9,
    imageUrl: searchEngine,
  },
  { key: 'tennis', name: 'Tennis Rockets', count: 14, imageUrl: tennis },
  { key: 'gym', name: 'Gym Dumbbells', count: 21, imageUrl: dumbbells },
  {
    key: 'badminton',
    name: 'Badminton Balls',
    count: 11,
    imageUrl: badminton,
  },
  { key: 'boxing', name: 'Boxing Gloves', count: 6, imageUrl: boxing },
];

const phoneWidth = 390;
const boardWidth = 680;

function StageTheme({
  palette,
  children,
}: {
  palette: DesignPalette;
  children: ReactNode;
}) {
  const design = normalizeDesign({ palette, shape: 'soft' });
  return (
    <div
      className="preview-stage"
      style={
        {
          ...designTheme(design),
          '--brand-primary': 'var(--brand-secondary)',
          '--brand-on-primary': '#ffffff',
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

function ShopChrome({
  shopName,
  children,
}: {
  shopName: string;
  children: ReactNode;
}) {
  return (
    <div className="preview-shop">
      <header className="preview-shop-head">
        <span className="preview-shop-logo" aria-hidden="true">
          {shopName.slice(0, 1)}
        </span>
        <span className="preview-shop-id">
          <strong>{shopName}</strong>
          <small>Independent shop</small>
        </span>
        <span className="preview-shop-tabs" aria-hidden="true">
          <b>Posts</b>
          <b className="is-active">Shop</b>
        </span>
      </header>
      <div className="preview-shop-body">{children}</div>
    </div>
  );
}

function ChipRow({ groups }: { groups: MenuCategoryGroup[] }) {
  return (
    <div className="preview-chip-demo">
      <div className="shop-menu-chips" role="group" aria-label="Shop sections">
        <button type="button" className="is-active">
          All items
          <span className="shop-chip-count">
            {groups.reduce((sum, group) => sum + group.count, 0)}
          </span>
        </button>
        {groups.map((group) => (
          <button type="button" key={group.key}>
            {group.name}
            <span className="shop-chip-count">{group.count}</span>
          </button>
        ))}
      </div>
      <p className="preview-chip-note">
        The classic shop keeps this filter row and no category cards. Every card
        style replaces it with the directory above.
      </p>
    </div>
  );
}

function Frame({
  label,
  meta,
  width,
  children,
}: {
  label: string;
  meta: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <figure className={`preview-size${width ? ' is-fixed' : ''}`}>
      <figcaption>
        <strong>{label}</strong>
        <span>{meta}</span>
      </figcaption>
      <div className="preview-frame">
        <div
          className="preview-canvas"
          style={width ? { width: `${width}px` } : undefined}
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

export function PreviewApp() {
  // Dev-bench shortcuts, e.g. ?style=split&palette=night&images=0&all=1.
  const params = new URLSearchParams(window.location.search);
  const requestedStyle = params.get('style');
  const requestedPalette = params.get('palette');
  const [style, setStyle] = useState<CategoryIndexStyle>(() =>
    categoryIndexStyles.includes(requestedStyle as CategoryIndexStyle)
      ? (requestedStyle as CategoryIndexStyle)
      : 'poster',
  );
  const [palette, setPalette] = useState<DesignPalette>(() =>
    paletteChoices().some((choice) => choice.key === requestedPalette)
      ? (requestedPalette as DesignPalette)
      : 'ivory',
  );
  const [showImages, setShowImages] = useState(params.get('images') !== '0');
  const [showAction, setShowAction] = useState(params.get('action') !== '0');
  const [splitTitle, setSplitTitle] = useState(params.get('split') !== '0');
  const [showAll, setShowAll] = useState(params.get('all') === '1');
  const [customImage, setCustomImage] = useState('');
  const galleryOnly = params.get('view') === 'gallery';
  const boardOnly = params.get('view') === 'board';
  const phoneOnly = params.get('view') === 'phone';

  const design = normalizeDesign({
    palette,
    shape: 'soft',
    categoryIndexStyle: style,
    showCategoryImages: showImages,
    showCategoryAction: showAction,
    splitCategoryTitle: splitTitle,
  });
  // A pasted link replaces the first sample, so the owner can test a real PNG
  // without saving anything to the database.
  const tried = customImage.trim();
  const sampleGroups = samples.map((group, index) =>
    index === 0 && tried ? { ...group, imageUrl: tried } : group,
  );
  const groups = showAll ? sampleGroups : sampleGroups.slice(0, 4);
  const info = categoryIndexStyleInfo[style];

  const renderDirectory = () =>
    style === 'chips' ? (
      <ChipRow groups={groups} />
    ) : (
      <CategoryShowcase categories={groups} design={design} shopSlug="iconly" />
    );

  // A clean, full-width phone view: useful for a real mobile screenshot and
  // for judging the horizontal category rail without the desktop bench.
  if (phoneOnly) {
    return (
      <main className="preview-phone-page">
        <StageTheme palette={palette}>
          <ShopChrome shopName="Iconly Studio">
            <div
              className="preview-link-block"
              onClickCapture={(event) => event.preventDefault()}
            >
              {renderDirectory()}
            </div>
          </ShopChrome>
        </StageTheme>
      </main>
    );
  }

  return (
    <>
      <header className="preview-topbar">
        <div className="preview-topbar-inner">
          <div>
            <span className="preview-eyebrow">
              SHOP DESIGN · CATEGORY CARDS
            </span>
            <h1>Category cards, styled like the boards.</h1>
            <p>
              Live preview of the card directory owners choose in the design
              studio. Cards use each category&apos;s own image link and name.
            </p>
          </div>
          <code>/category-preview.html</code>
        </div>
      </header>

      <main
        className={`preview-main${boardOnly ? ' is-board-only' : ''}${galleryOnly ? ' is-gallery-only' : ''}`}
      >
        {!galleryOnly && (
          <div className="preview-layout">
            <aside className="preview-controls">
              <section className="preview-control">
                <h2>Card style</h2>
                <div className="preview-style-list">
                  {categoryIndexStyles.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={value === style ? 'is-selected' : undefined}
                      aria-pressed={value === style}
                      onClick={() => setStyle(value)}
                    >
                      <strong>{categoryIndexStyleInfo[value].label}</strong>
                      <small>{categoryIndexStyleInfo[value].hint}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="preview-control">
                <h2>Labels &amp; pictures</h2>
                <label className="preview-toggle">
                  <input
                    type="checkbox"
                    checked={showImages}
                    onChange={(event) => setShowImages(event.target.checked)}
                  />
                  Show category pictures
                </label>
                <label className="preview-toggle">
                  <input
                    type="checkbox"
                    checked={showAction}
                    onChange={(event) => setShowAction(event.target.checked)}
                  />
                  Show the “Learn more” link
                </label>
                <label className="preview-toggle">
                  <input
                    type="checkbox"
                    checked={splitTitle}
                    onChange={(event) => setSplitTitle(event.target.checked)}
                  />
                  Split the name into two tones
                </label>
              </section>

              <section className="preview-control">
                <h2>Palette</h2>
                <div className="preview-palettes">
                  {paletteChoices().map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      className={
                        choice.key === palette ? 'is-selected' : undefined
                      }
                      aria-pressed={choice.key === palette}
                      onClick={() => setPalette(choice.key)}
                      title={choice.label}
                    >
                      <span
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
              </section>

              <section className="preview-control">
                <h2>Try your PNG link</h2>
                <input
                  className="preview-url-input"
                  type="url"
                  inputMode="url"
                  value={customImage}
                  onChange={(event) => setCustomImage(event.target.value)}
                  placeholder="https://…/category.png"
                  aria-label="Test a category image link"
                />
                <p className="preview-note">
                  The link replaces the first card only. A transparent PNG sits
                  on the card colour — the real shop works the same way.
                </p>
                {customImage && (
                  <button
                    type="button"
                    className="preview-clear-url"
                    onClick={() => setCustomImage('')}
                  >
                    Clear link
                  </button>
                )}
              </section>

              <section className="preview-control">
                <h2>Sample</h2>
                <label className="preview-toggle">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(event) => setShowAll(event.target.checked)}
                  />
                  Show all 8 categories
                </label>
                <p className="preview-note">
                  <strong>{info.label}</strong> — {info.hint}
                </p>
              </section>

              <p className="preview-help">
                In the dashboard: <b>Shop design → Category cards</b> picks the
                style; <b>Products / menu → Manage categories</b> stores each
                image link. A PNG with a transparent background sits on the card
                colour — the same trick as the reference boards.
              </p>
            </aside>

            <div className="preview-stages">
              <Frame
                label="Board width"
                meta={`${boardWidth}px · the width of the reference boards`}
                width={boardWidth}
              >
                <StageTheme palette={palette}>
                  <ShopChrome shopName="Iconly Studio">
                    <div
                      className="preview-link-block"
                      onClickCapture={(event) => event.preventDefault()}
                    >
                      {renderDirectory()}
                    </div>
                  </ShopChrome>
                </StageTheme>
              </Frame>

              <Frame
                label="Phone"
                meta={`${phoneWidth}px · one card per row`}
                width={phoneWidth}
              >
                <StageTheme palette={palette}>
                  <ShopChrome shopName="Iconly Studio">
                    <div
                      className="preview-link-block"
                      onClickCapture={(event) => event.preventDefault()}
                    >
                      {renderDirectory()}
                    </div>
                  </ShopChrome>
                </StageTheme>
              </Frame>
            </div>
          </div>
        )}

        <section className="preview-gallery">
          <div className="preview-gallery-head">
            <div>
              <span className="preview-eyebrow">ALL STYLES</span>
              <h2>The same categories, six ways.</h2>
            </div>
            <p>
              The board below every style with the current labels and palette,
              so the difference between the cards is visible at a glance.
            </p>
          </div>
          <div className="preview-gallery-grid">
            {categoryIndexStyles.map((value) => (
              <article
                className={`preview-gallery-item${value === 'chips' ? ' is-chips' : ''}`}
                key={value}
              >
                <header>
                  <strong>{categoryIndexStyleInfo[value].label}</strong>
                  <span>{categoryIndexStyleInfo[value].hint}</span>
                </header>
                <StageTheme palette={palette}>
                  <div
                    className="preview-gallery-canvas"
                    onClickCapture={(event) => event.preventDefault()}
                  >
                    {value === 'chips' ? (
                      <ChipRow groups={groups} />
                    ) : (
                      <CategoryShowcase
                        categories={groups}
                        design={normalizeDesign({
                          palette,
                          shape: 'soft',
                          categoryIndexStyle: value,
                          showCategoryImages: showImages,
                          showCategoryAction: showAction,
                          splitCategoryTitle: splitTitle,
                        })}
                        shopSlug="iconly"
                      />
                    )}
                  </div>
                </StageTheme>
              </article>
            ))}
          </div>
        </section>

        <section className="preview-references">
          <div className="preview-references-head">
            <h2>Reference boards</h2>
            <p>
              The two supplied boards. The cards above keep the same contract: a
              picture, the category name in two tones, and a learn-more
              affordance.
            </p>
          </div>
          <div className="preview-reference-grid">
            <figure>
              <img
                src={referenceLight}
                alt="Category card reference board with light and orange cards"
              />
              <figcaption>01 · light and colour cards</figcaption>
            </figure>
            <figure>
              <img
                src={referenceDark}
                alt="Category card reference board with dark photo cards"
              />
              <figcaption>02 · photo cards on deep backgrounds</figcaption>
            </figure>
          </div>
        </section>
      </main>
    </>
  );
}
