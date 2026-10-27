import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { getJson, mutate, panelError } from './panel-api';
import { Notice } from './PanelUI';
import { storeMediaUrl } from '../../lib/storefront';

export type UploadPurpose =
  'post' | 'store_logo' | 'store_banner' | 'product_image';
interface MediaStatus {
  id: string;
  status: string;
  kind: string;
  variants: { key: string; mimeType: string; width: number }[];
}
export function MediaUpload({
  targetId,
  purpose,
  label,
  keys = [],
  onChange,
  onBusy,
  onPending,
  maxImageBytes,
  maxVideoBytes,
  allowVideo = false,
  disabled = false,
}: {
  targetId: string;
  purpose: UploadPurpose;
  label: string;
  keys?: string[];
  onChange: (keys: string[]) => void;
  onBusy: (busy: boolean) => void;
  onPending?: (pending: boolean) => void;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  allowVideo?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string>();
  useEffect(() => {
    onPending?.(Boolean(pendingId));
  }, [pendingId, onPending]);
  const request = useRef<XMLHttpRequest | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  const isGallery = purpose === 'product_image' || purpose === 'post';
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
        onChange(isGallery ? [...keys, preferred.key] : [preferred.key]);
        setPendingId(undefined);
        setProgress('Ready. Save your changes to finish.');
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
    onBusy(true);
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
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
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
    onBusy(true);
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
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section className="panel-upload">
      <h3>{label}</h3>
      {!!keys.length && (
        <div className="panel-photo-grid">
          {keys.map((key) => (
            <div key={key}>
              {/\.mp4$/i.test(key) ? (
                <video controls preload="metadata" src={storeMediaUrl(key)} />
              ) : (
                <img src={storeMediaUrl(key)} alt={label} />
              )}
              {purpose !== 'post' && (
                <button
                  type="button"
                  aria-label={`Remove ${label.toLowerCase()}`}
                  disabled={busy || disabled}
                  onClick={() =>
                    onChange(keys.filter((value) => value !== key))
                  }
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <label
        className={`panel-upload-zone ${disabled || busy || pendingId ? 'disabled' : ''}`}
      >
        <ImagePlus size={24} />
        <strong>
          {busy
            ? progress
            : keys.length && !isGallery
              ? 'Choose a replacement'
              : 'Choose from your device'}
        </strong>
        <small>
          JPG, PNG, WebP or AVIF · up to{' '}
          {Math.round((maxImageBytes ?? 10485760) / 1048576)} MB
          {allowVideo &&
            ` · videos up to ${Math.round((maxVideoBytes ?? 52428800) / 1048576)} MB`}
        </small>
        <input
          type="file"
          disabled={disabled || busy || Boolean(pendingId)}
          accept={`image/jpeg,image/png,image/webp,image/avif${allowVideo ? ',video/mp4,video/quicktime,video/webm' : ''}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {progress && !busy && (
        <p role="status" className="panel-muted">
          {progress}
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      {pendingId && !busy && (
        <button type="button" onClick={() => void check()}>
          Check upload status
        </button>
      )}
    </section>
  );
}
