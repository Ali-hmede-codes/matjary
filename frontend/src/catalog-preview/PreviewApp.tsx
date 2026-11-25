import { useEffect, useRef, useState } from 'react';
import {
  catalogLayoutGroupInfo,
  catalogLayoutGroupOf,
  catalogLayoutInfo,
  catalogLayouts,
  type CatalogLayout,
} from '../lib/catalog-layouts';

const phoneWidth = 390;
const desktopWidth = 1280;

/**
 * One grid in an iframe, because the layouts switch on viewport media queries:
 * only a real viewport makes a 390px phone frame and a 1280px desktop frame
 * show their actual rules side by side. The embed reports its own height; the
 * frame scales down to its column but never beyond its own viewport width.
 */
function PreviewFrame({
  frameId,
  layout,
  count,
  width,
  inCart,
  caption,
  measuredHeight,
}: {
  frameId: string;
  layout: CatalogLayout;
  count: number;
  width: number;
  inCart: boolean;
  caption: string;
  measuredHeight?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const height = measuredHeight ?? (width > 700 ? 560 : 380);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const update = () => setScale(Math.min(1, node.clientWidth / width));
    update();
    const watcher = new ResizeObserver(update);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [width]);

  const params = new URLSearchParams({
    embed: '1',
    layout,
    count: String(count),
    frame: frameId,
  });
  if (inCart) params.set('incart', '1');
  return (
    <figure className="preview-frame">
      <figcaption>{caption}</figcaption>
      <div
        className="preview-host"
        ref={host}
        style={{ height: `${Math.round(height * scale)}px` }}
      >
        <iframe
          src={`?${params.toString()}`}
          title={caption}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </figure>
  );
}

function PreviewCard({
  layout,
  counts,
  inCart,
  heights,
}: {
  layout: CatalogLayout;
  counts: number[];
  inCart: boolean;
  heights: Record<string, number>;
}) {
  const info = catalogLayoutInfo[layout];
  const group = catalogLayoutGroupInfo[catalogLayoutGroupOf[layout]];
  const frameId = (surface: string, count: number) =>
    `${layout}-${surface}-${count}-${inCart ? 'cart' : 'plain'}`;
  const caption = (surface: string, width: number, count: number) =>
    `${surface} · ${width}px · ${count === 1 ? '1 product' : `${count} products`}`;
  const frame = (surface: 'phone' | 'desktop', count: number) => {
    const width = surface === 'phone' ? phoneWidth : desktopWidth;
    const id = frameId(surface, count);
    return (
      <PreviewFrame
        key={id}
        frameId={id}
        layout={layout}
        count={count}
        width={width}
        inCart={inCart}
        caption={caption(
          surface === 'phone' ? 'Phone' : 'Desktop',
          width,
          count,
        )}
        measuredHeight={heights[id]}
      />
    );
  };
  return (
    <section className="preview-card" id={`layout-${layout}`}>
      <header className="preview-card-head">
        <span className="preview-group">{group.label}</span>
        <h2>
          {info.label} <code>{layout}</code>
        </h2>
        <p>{info.hint}</p>
      </header>
      <div className="preview-row is-phone">
        {counts.map((count) => frame('phone', count))}
      </div>
      <div className="preview-row is-desktop">
        {counts.map((count) => frame('desktop', count))}
      </div>
    </section>
  );
}

/**
 * Dev-only design bench: every grid at phone and desktop width, with one and
 * with six products, so a layout can be judged in the states that break.
 *   /catalog-preview.html
 *   /catalog-preview.html?layouts=zigzag,index,rows&count=1,6&incart=1
 */
export function PreviewApp({ params }: { params: URLSearchParams }) {
  const requested = params.get('layouts')?.split(',').filter(Boolean) ?? [];
  const layouts = catalogLayouts.filter(
    (layout) => !requested.length || requested.includes(layout),
  );
  const counts = (params.get('count') ?? '1,6')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 4);
  const inCart = params.get('incart') === '1';
  const [heights, setHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        frame?: unknown;
        height?: unknown;
      };
      if (data?.type !== 'catalog-preview-height') return;
      if (typeof data.frame !== 'string' || typeof data.height !== 'number')
        return;
      if (data.height < 40) return;
      setHeights((current) =>
        current[data.frame as string] === data.height
          ? current
          : { ...current, [data.frame as string]: data.height as number },
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <>
      <header className="preview-topbar">
        <div className="preview-topbar-inner">
          <div>
            <strong>Product section grids</strong>
            <span>
              {layouts.length} layouts · phone {phoneWidth}px and desktop{' '}
              {desktopWidth}px · mock products
            </span>
          </div>
          <code>?layouts=zigzag,index,rows&amp;count=1,6&amp;incart=1</code>
        </div>
      </header>
      <main className="preview-main">
        {layouts.map((layout) => (
          <PreviewCard
            key={layout}
            layout={layout}
            counts={counts.length ? counts : [1, 6]}
            inCart={inCart}
            heights={heights}
          />
        ))}
      </main>
    </>
  );
}
