import { useEffect } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Notice } from './PanelUI';
import { storeMediaUrl } from '../../lib/storefront';
import {
  useMediaUpload,
  type UploadPurpose,
  type UploadTarget,
} from './useMediaUpload';

export type { UploadPurpose };

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
  targetId: UploadTarget;
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
  const isGallery = purpose === 'product_image' || purpose === 'post';
  // The hook reports the processed asset; this editor only tracks the saved
  // variant keys it will submit with the rest of the form.
  const upload = useMediaUpload({
    targetId,
    purpose,
    maxImageBytes,
    maxVideoBytes,
    allowVideo,
    onReady: ({ key }) => onChange(isGallery ? [...keys, key] : [key]),
  });
  const {
    busy,
    uploading,
    progress,
    error,
    pendingId,
    upload: start,
    check,
  } = upload;

  // Report only the network phase: once the bytes are queued the worker keeps
  // encoding, and a post editor may publish without waiting for that.
  useEffect(() => {
    onBusy(uploading);
  }, [uploading, onBusy]);
  useEffect(() => {
    onPending?.(Boolean(pendingId));
  }, [pendingId, onPending]);

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
            if (file) void start(file);
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
