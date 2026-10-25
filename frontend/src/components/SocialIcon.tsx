import type { ReactNode } from 'react';
import {
  Globe,
  MessageCircle,
  Music2,
  Send,
  type LucideIcon,
} from 'lucide-react';

const socialIcons: Record<string, LucideIcon> = {
  tiktok: Music2,
  whatsapp: MessageCircle,
  telegram: Send,
  website: Globe,
};

// Brand marks stay local because the shared icon set has no brand icons.
const socialMarks: Record<string, ReactNode> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <path
      d="M14 22v-9h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.4c-.7-.1-1.7-.2-3-.2C11.6 1.2 9 3.3 9 7v2H6v4h3v9Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  twitter: (
    <path
      d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.4L1.6 2H8l4.5 6.8L18.9 2ZM17.8 20h1.7L7.1 4H5.3L17.8 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="m10 9 6 3-6 3Z" fill="currentColor" stroke="none" />
    </>
  ),
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
  const mark = socialMarks[network];
  if (mark)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {mark}
      </svg>
    );
  const Icon = socialIcons[network] ?? Globe;
  return <Icon size={size} aria-hidden="true" />;
}
