import {
  siFacebook,
  siInstagram,
  siTelegram,
  siTiktok,
  siWhatsapp,
  siX,
  siYoutube,
} from 'simple-icons';
import { Globe } from 'lucide-react';

// Official brand glyphs (Simple Icons, CC0) instead of generic stand-ins: a
// shop's links are recognisable at a glance, which a chat-bubble or note icon
// never is. Solid marks read better than stroke art on the round tiles.
const brandMarks: Record<string, { path: string } | undefined> = {
  instagram: siInstagram,
  facebook: siFacebook,
  tiktok: siTiktok,
  twitter: siX,
  youtube: siYoutube,
  telegram: siTelegram,
  whatsapp: siWhatsapp,
};

export const socialNetworks = [
  {
    network: 'instagram',
    label: 'Instagram',
    placeholder: 'https://instagram.com/yourshop',
  },
  {
    network: 'facebook',
    label: 'Facebook',
    placeholder: 'https://facebook.com/yourshop',
  },
  {
    network: 'tiktok',
    label: 'TikTok',
    placeholder: 'https://tiktok.com/@yourshop',
  },
  {
    network: 'twitter',
    label: 'X',
    placeholder: 'https://x.com/yourshop',
  },
  {
    network: 'youtube',
    label: 'YouTube',
    placeholder: 'https://youtube.com/@yourshop',
  },
  {
    network: 'telegram',
    label: 'Telegram',
    placeholder: 'https://t.me/yourshop',
  },
  {
    network: 'website',
    label: 'Website',
    placeholder: 'https://yourshop.com',
  },
  {
    network: 'whatsapp',
    label: 'Order WhatsApp',
    placeholder: 'https://wa.me/96170123456',
  },
] as const;

export function SocialIcon({
  network,
  size = 20,
}: {
  network: string;
  size?: number;
}) {
  const mark = brandMarks[network];
  if (mark)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d={mark.path} />
      </svg>
    );
  // Anything without a trademark (websites, unknown links) keeps the neutral
  // outline globe so the tile never shows a wrong logo.
  return <Globe size={size} aria-hidden="true" />;
}
