import { useEffect, useState } from 'react';

const SHARE_NOTICE_MS = 5000;

export interface SharePayload {
  title: string;
  text?: string;
  url: string;
}

/**
 * Web Share with a clipboard fallback. Failures never throw into the page and
 * the message stays generic, matching the storefront's sanitized feedback.
 */
export function useShare(): {
  share: (data: SharePayload) => Promise<void>;
  sharing: boolean;
  notice: string;
} {
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), SHARE_NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function share(data: SharePayload): Promise<void> {
    if (sharing) return;
    setNotice('');
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(data.url);
        setNotice('Link copied.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setNotice(
          'Couldn’t share the link. You can copy it from the address bar.',
        );
      }
    } finally {
      setSharing(false);
    }
  }

  return { share, sharing, notice };
}
