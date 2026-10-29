import './StoreQr.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Copy, Download, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { storeMediaUrl } from '../../lib/storefront';
import { qrFileName, qrLogoPlate, shopShareUrl } from '../../lib/shop-qr';
import { Notice, PageTitle } from '../shared/PanelUI';
import { useOwner } from './OwnerPanel';

const QR_SIZE = 1024;

// The logo is fetched as bytes and drawn from a blob URL: a same-origin fetch
// never taints the canvas, so the PNG download keeps working behind the proxy.
async function loadLogo(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('logo'));
      image.src = objectUrl;
    });
    return image;
  } finally {
    // The decoded image stays usable after the temporary URL is released.
    URL.revokeObjectURL(objectUrl);
  }
}

function drawLogo(canvas: HTMLCanvasElement, logo: HTMLImageElement) {
  const context = canvas.getContext('2d');
  if (!context || !logo.naturalWidth || !logo.naturalHeight) return;
  const { plate, padding, radius } = qrLogoPlate(canvas.width);
  const start = (canvas.width - plate) / 2;
  // A white rounded plate keeps the logo readable and separates it from the
  // surrounding modules the error correction has to rebuild.
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(start, start, plate, plate, radius);
  context.fill();
  const inner = plate - padding * 2;
  const scale = Math.min(inner / logo.naturalWidth, inner / logo.naturalHeight);
  const width = logo.naturalWidth * scale;
  const height = logo.naturalHeight * scale;
  context.drawImage(
    logo,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
}

export function StoreQr() {
  const { store } = useOwner();
  const [png, setPng] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // The QR always encodes the public shop address, even while the owner is
  // signed in to the dashboard.
  const url = store ? shopShareUrl(window.location.origin, store.slug) : null;
  const logoUrl = store ? storeMediaUrl(store.logoKey) : undefined;
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setPng('');
    setError('');
    if (!url) {
      if (store) setError('This shop address cannot be turned into a link.');
      return;
    }
    const canvas = document.createElement('canvas');
    void (async () => {
      try {
        await QRCode.toCanvas(canvas, url, {
          errorCorrectionLevel: 'H',
          margin: 3,
          width: QR_SIZE,
          color: { dark: '#10140f', light: '#ffffff' },
        });
        if (logoUrl) {
          const logo = await loadLogo(logoUrl, controller.signal).catch(
            () => null,
          );
          if (logo) drawLogo(canvas, logo);
        }
        if (alive) setPng(canvas.toDataURL('image/png'));
      } catch {
        if (alive)
          setError(
            'The QR code could not be generated. Reload the page to try again.',
          );
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [url, logoUrl]);
  if (!store) return null;
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow={store.name}
        title="Shop QR code"
        description="A printable code that opens your public shop page. Your shop logo is placed in the middle automatically."
        action={<span className="panel-pill">PNG · 1024 px</span>}
      />
      {error && <Notice error>{error}</Notice>}
      <div className="panel-two-columns">
        <section className="panel-card shop-qr-preview">
          <h2>Preview</h2>
          {png ? (
            <img
              src={png}
              width={QR_SIZE}
              height={QR_SIZE}
              alt={`QR code that opens ${store.name}`}
            />
          ) : (
            <div className="shop-qr-placeholder" aria-hidden="true">
              <QrCode size={48} />
            </div>
          )}
          {png ? (
            <a
              className="panel-primary"
              href={png}
              download={qrFileName(store.slug)}
            >
              <Download size={16} /> Download PNG
            </a>
          ) : null}
          <small>
            Save the file and print it on your shop window, receipts, or
            packaging. The code stays valid while the shop address is unchanged.
          </small>
        </section>
        <section className="panel-card">
          <h2>Where it points</h2>
          <p className="panel-muted">
            Every scan opens your published shop page. Keep the link correct and
            the code keeps working for as long as the shop exists.
          </p>
          <input
            className="shop-qr-link"
            readOnly
            value={url ?? ''}
            aria-label="Shop link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="panel-actions">
            <button
              type="button"
              className="panel-secondary"
              disabled={!url}
              onClick={() => void copy()}
            >
              <Copy size={16} /> {copied ? 'Copied' : 'Copy link'}
            </button>
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              Open shop <ArrowUpRight size={16} />
            </Link>
          </div>
          <ul className="shop-qr-tips">
            <li>
              <QrCode size={16} />
              <span>
                Your logo sits in the middle with a white plate behind it, so
                the code still scans.
              </span>
            </li>
            <li>
              <Download size={16} />
              <span>
                Saving a new logo in the store editor updates this code the next
                time you open the page.
              </span>
            </li>
            <li>
              <Copy size={16} />
              <span>
                The download is a 1024-pixel PNG, big enough for small posters.
              </span>
            </li>
          </ul>
          {!logoUrl && !error && (
            <p className="panel-muted">
              Add a shop logo in the store editor to print it inside the code.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
