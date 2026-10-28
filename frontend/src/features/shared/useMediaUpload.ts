import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { getJson, mutate, panelError } from './panel-api';

export type UploadPurpose =
  'post' | 'store_logo' | 'store_banner' | 'product_image' | 'store_story';

interface MediaStatus {
  id: string;
  status: string;
  kind: string;
  variants: { key: string; mimeType: string; width: number }[];
}

export interface UploadedMedia {
  id: string;
  key: string;
}

// The editor and the story composer share one upload pipeline: negotiate a
// pending asset, PUT the bytes, mark it complete, then poll until the worker
// has processed it. Keeping it in a hook means both flows get the same abort,
// progress, and cleanup behavior.
export function useMediaUpload({
  targetId,
  purpose,
  maxImageBytes,
  maxVideoBytes,
  allowVideo = false,
  readyMessage = 'Ready. Save your changes to finish.',
  onReady,
}: {
  targetId: string;
  purpose: UploadPurpose;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  allowVideo?: boolean;
  readyMessage?: string;
  onReady: (media: UploadedMedia) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string>();
  const request = useRef<XMLHttpRequest | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  // The callback changes with the parent's state; a ref keeps polling current.
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);

  async function finish(id: string) {
    const waitingSince = Date.now();
    // One-second polls keep the wait short: encoding now finishes in a few
    // seconds, and a completed job should not sit unseen for two.
    for (let n = 0; n < 90; n++) {
      if (!alive.current) return;
      const status = await getJson<MediaStatus>(`media/${id}`);
      if (status.status === 'failed') {
        setPendingId(undefined);
        throw new Error('invalid-media');
      }
      if (status.status === 'ready') {
        const preferred =
          status.variants
            .filter(
              (v) =>
                v.mimeType ===
                (status.kind === 'video' ? 'video/mp4' : 'image/webp'),
            )
            .sort(
              (a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080),
            )[0] ?? status.variants[0];
        if (!preferred) throw new Error('invalid-media');
        ready.current({ id, key: preferred.key });
        setPendingId(undefined);
        setProgress(readyMessage);
        return;
      }
      setProgress(
        `Uploaded. Optimizing your media… ${Math.max(1, Math.round((Date.now() - waitingSince) / 1000))}s`,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    setProgress('Still processing. You can check again in a moment.');
  }

  async function check() {
    if (!pendingId || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const status = await getJson<MediaStatus>(`media/${pendingId}`);
      if (status.status === 'pending')
        await mutate(`media/${pendingId}/complete`);
      await finish(pendingId);
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'invalid-media'
          ? 'This file could not be processed. Choose another supported file.'
          : panelError(e),
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function upload(file: File) {
    if (lock.current) return;
    const video = file.type.startsWith('video/');
    const allowed =
      video && allowVideo
        ? ['video/mp4', 'video/quicktime', 'video/webm']
        : ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    const max = video
      ? (maxVideoBytes ?? 50 * 1024 * 1024)
      : (maxImageBytes ?? 10 * 1024 * 1024);
    if (!allowed.includes(file.type) || file.size <= 0 || file.size > max) {
      setError(
        `Choose a supported ${allowVideo ? 'photo or video' : 'photo'} within the size limit.`,
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setProgress('Preparing upload…');
    let negotiatedId: string | undefined;
    let uploaded = false;
    try {
      const negotiated = await mutate<{ url: string; mediaId: string }>(
        'media/uploads',
        {
          targetId,
          purpose,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          kind: video ? 'video' : 'image',
        },
      );
      negotiatedId = negotiated.mediaId;
      const url = new URL(negotiated.url, window.location.origin);
      // Local development uses the same-origin proxy; signed S3 URLs stay untouched.
      const destination = url.pathname.startsWith('/api/v1/uploads/')
        ? url.pathname + url.search
        : url.href;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        request.current = xhr;
        xhr.open('PUT', destination);
        xhr.timeout = 120_000;
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (alive.current && e.lengthComputable)
            setProgress(`Uploading ${Math.round((e.loaded / e.total) * 100)}%`);
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new ApiError(xhr.status));
        xhr.onerror =
          xhr.ontimeout =
          xhr.onabort =
            () => reject(new Error('upload-failed'));
        xhr.send(file);
      });
      uploaded = true;
      setPendingId(negotiated.mediaId);
      await mutate(`media/${negotiated.mediaId}/complete`);
      await finish(negotiated.mediaId);
    } catch (e) {
      if (!uploaded && negotiatedId)
        await mutate(`media/${negotiatedId}/abandon`).catch(() => undefined);
      if (alive.current)
        setError(
          e instanceof Error && e.message === 'invalid-media'
            ? 'This file could not be processed. Choose another supported file.'
            : panelError(e),
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return { busy, progress, error, pendingId, upload, check };
}
