// QR codes are printed and scanned far from the app, so the encoded link must
// be the public storefront URL and nothing else — no dashboard, no query.
export function shopShareUrl(origin: string, slug: string): string | null {
  const safe = typeof slug === 'string' ? slug.trim() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(safe) || safe.length > 191)
    return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    return `${base.origin}/stores/${safe}`;
  } catch {
    return null;
  }
}

// The centered logo plate stays well under a third of the symbol width, which
// is what level-H error correction can rebuild, so scanning still works after
// the logo covers the middle modules.
export function qrLogoPlate(size: number): {
  plate: number;
  padding: number;
  radius: number;
} {
  const plate = Math.round(size * 0.26);
  return {
    plate,
    padding: Math.round(size * 0.02),
    radius: Math.round(size * 0.035),
  };
}

// A stable, filesystem-safe name for the downloaded card.
export function qrFileName(slug: string): string {
  const safe = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  return `${/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(safe) ? safe : 'shop'}-qr.png`;
}
