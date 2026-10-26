export interface PreviewImageVariant {
  mimeType: string;
  width: number;
  sizeBytes: string;
}

// WhatsApp drops link images noticeably above this size, and WebP/AVIF cards
// are still inconsistent across preview clients. A compact JPEG/PNG is the
// most reliable image a share card can advertise.
const MAX_PREVIEW_BYTES = 300_000;

/**
 * Variants are expected ordered by width descending (the media query does
 * this). Prefer the widest compact JPEG/PNG, then the smallest JPEG/PNG, and
 * only then any image variant.
 */
export function choosePreviewImage<T extends PreviewImageVariant>(
  variants: T[],
): T | undefined {
  const images = variants.filter((entry) =>
    /^image\/(?:jpeg|png)$/iu.test(entry.mimeType),
  );
  const compact = images.filter((entry) => {
    const size = Number(entry.sizeBytes);
    return Number.isFinite(size) && size > 0 && size <= MAX_PREVIEW_BYTES;
  });
  return (
    compact.find((entry) => entry.width >= 600) ??
    compact.at(-1) ??
    images.at(-1) ??
    variants.find((entry) => entry.mimeType.startsWith('image/'))
  );
}
