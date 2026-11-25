import type { CoverShape } from '../lib/design';

// Each path fills the page-coloured shape that cuts into the bottom of the
// cover. The viewBox is deliberately shallow (100 x 20) and stretched to the
// banner width, so one path works from phone to desktop. Soft variants draw a
// translucent layer first and the solid edge last.
type CoverEdgePath = { d: string; opacity?: number };

// Drops repeats one narrow, round-ended drip across the edge. Building the
// path keeps the spacing even and leaves enough flat edge between drips.
function dropsEdge(): string {
  let path = 'M0 9';
  for (let x = 4; x <= 94; x += 5) {
    path += ` L${x} 9 Q${x} 10 ${x} 11 L${x} 14 Q${x} 16 ${x + 1} 16 Q${x + 2} 16 ${x + 2} 14 L${x + 2} 11 Q${x + 2} 9 ${x + 3} 9`;
  }
  return `${path} L100 9 L100 20 L0 20 Z`;
}

const coverEdgePaths: Record<
  Exclude<CoverShape, 'none'>,
  readonly CoverEdgePath[]
> = {
  waves: [
    {
      d: 'M0 8 C8 3 16 14 25 10 C34 6 42 14 50 10 C58 6 66 14 75 10 C84 6 92 14 100 8 L100 20 L0 20 Z',
    },
  ],
  fanOpacity: [
    { d: 'M0 12 Q50 6 100 12 L100 20 L0 20 Z', opacity: 0.3 },
    { d: 'M0 15 Q50 10 100 15 L100 20 L0 20 Z', opacity: 0.45 },
    { d: 'M0 17 Q50 13 100 17 L100 20 L0 20 Z' },
  ],
  triangle: [{ d: 'M0 8 L50 16 L100 8 L100 20 L0 20 Z' }],
  tiltOpacity: [
    { d: 'M0 9 L100 2 L100 6 L0 13 Z', opacity: 0.35 },
    { d: 'M0 13 L100 6 L100 20 L0 20 Z' },
  ],
  drops: [{ d: dropsEdge() }],
  curve: [{ d: 'M0 9 Q50 18 100 9 L100 20 L0 20 Z' }],
  wavesBrush: [
    {
      d: 'M0 8 C12 2 22 14 34 8 C46 2 56 14 68 8 C80 2 90 13 100 7 L100 20 L0 20 Z',
      opacity: 0.3,
    },
    {
      d: 'M0 10 C12 4 22 16 34 10 C46 4 56 16 68 10 C80 4 90 15 100 9 L100 20 L0 20 Z',
    },
  ],
  pyramids: [{ d: 'M0 12 L25 5 L50 14 L75 5 L100 12 L100 20 L0 20 Z' }],
  tilt: [{ d: 'M0 13 L100 6 L100 20 L0 20 Z' }],
  triangleAsymmetrical: [{ d: 'M0 9 L32 16 L100 8 L100 20 L0 20 Z' }],
  wavesPattern: [
    {
      d: 'M0 11 Q5 7 10 11 Q15 7 20 11 Q25 7 30 11 Q35 7 40 11 Q45 7 50 11 Q55 7 60 11 Q65 7 70 11 Q75 7 80 11 Q85 7 90 11 Q95 7 100 11 L100 20 L0 20 Z',
    },
  ],
  book: [
    {
      d: 'M0 9 Q20 4 40 10 L50 12 L60 10 Q80 4 100 9 L100 20 L0 20 Z',
    },
  ],
  clouds: [
    {
      d: 'M0 12 C4 6 10 6 14 12 C18 6 24 6 28 12 C32 6 38 6 42 12 C46 6 52 6 56 12 C60 6 66 6 70 12 C74 6 80 6 84 12 C88 6 94 6 100 12 L100 20 L0 20 Z',
    },
  ],
  zigzag: [
    {
      d: 'M0 11 L5 8 L10 11 L15 8 L20 11 L25 8 L30 11 L35 8 L40 11 L45 8 L50 11 L55 8 L60 11 L65 8 L70 11 L75 8 L80 11 L85 8 L90 11 L95 8 L100 11 L100 20 L0 20 Z',
    },
  ],
  mountains: [
    {
      d: 'M0 11 L18 5 L32 11 L48 2 L64 11 L78 6 L90 11 L100 4 L100 20 L0 20 Z',
      opacity: 0.3,
    },
    {
      d: 'M0 13 L18 7 L32 13 L48 4 L64 13 L78 8 L90 13 L100 6 L100 20 L0 20 Z',
    },
  ],
  curveAsymmetrical: [{ d: 'M0 11 C25 3 55 17 100 7 L100 20 L0 20 Z' }],
};

/**
 * A decorative cut-out along the cover's bottom edge. It uses the surface
 * colour so the page appears to carve into the photo; nothing is clipped from
 * the photograph itself, so the hero keeps its full height.
 */
export function CoverEdge({ shape }: { shape: CoverShape }) {
  if (shape === 'none') return null;
  return (
    <svg
      className="cover-edge"
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {coverEdgePaths[shape].map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill="currentColor"
          opacity={path.opacity}
        />
      ))}
    </svg>
  );
}
