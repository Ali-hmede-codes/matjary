import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { enableMouseScrolling } from '../../../lib/website';

/**
 * A sideways rail. It scrolls on its own; the arrows give mouse and keyboard
 * shoppers the same "next card" a swipe gives touch screens. Shared by the
 * sideways rail, photo rail, banner and cover grids — the variant only names
 * the CSS frame.
 */
export function ShelfRail({
  children,
  count,
  variant = 'shelves',
}: {
  children: ReactNode;
  count: number;
  variant?: 'shelves' | 'rail' | 'banner' | 'cover';
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({
    scrollable: false,
    atStart: true,
    atEnd: true,
  });

  const measure = () => {
    const node = rail.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    // RTL runs scrollLeft from 0 down to -max, so compare the magnitude.
    const offset = Math.abs(node.scrollLeft);
    const next = {
      scrollable: max > 2,
      atStart: offset <= 2,
      atEnd: offset >= max - 2,
    };
    setNav((current) =>
      current.scrollable === next.scrollable &&
      current.atStart === next.atStart &&
      current.atEnd === next.atEnd
        ? current
        : next,
    );
  };

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    measure();
    // The rail keeps its own box width, so only a card count change (or a
    // breakpoint resize) can make the row overflow or stop overflowing.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  const scroll = (direction: 1 | -1) => {
    const node = rail.current;
    if (!node) return;
    const rtl = getComputedStyle(node).direction === 'rtl';
    const step = Math.max(node.clientWidth * 0.8, 180);
    node.scrollBy({
      left: (rtl ? -direction : direction) * step,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

  // One ref both measures the rail and gives it the site-wide wheel and drag
  // scrolling, so the rail behaves like every other horizontal strip.
  const attachRail = (node: HTMLDivElement | null) => {
    rail.current = node;
    return enableMouseScrolling(node);
  };

  return (
    <div className={`shop-catalog-rail is-${variant}`}>
      <div
        className={`shop-catalog-items layout-${variant}`}
        ref={attachRail}
        onScroll={measure}
        role="group"
        aria-label="Products"
        tabIndex={0}
      >
        {children}
      </div>
      {nav.scrollable && (
        <div className="shop-rail-nav">
          <button
            type="button"
            className="shop-rail-arrow"
            aria-label="Scroll products backward"
            disabled={nav.atStart}
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="shop-rail-arrow"
            aria-label="Scroll products forward"
            disabled={nav.atEnd}
            onClick={() => scroll(1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
