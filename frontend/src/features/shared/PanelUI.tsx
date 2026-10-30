import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, Check, LogOut, Menu, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { mutate, panelError, type Session } from './panel-api';
import { brandingUrl } from '../../lib/website';
import { LanguageToggle } from '../../components/LanguageToggle';
import { useUiLabel } from '../../hooks/useUiLabel';

export function PanelShell({
  session,
  admin,
  member = false,
  children,
}: {
  session: Session;
  admin?: boolean;
  member?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  // Section labels are curated so the widget does not turn "Home" into "بيت".
  const uiText = useUiLabel();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const base = admin ? '/admin' : '/dashboard';
  const nav: Array<[string, string]> = admin
    ? [
        ['', 'Overview'],
        ['/users', 'Users'],
        ['/stores', 'Stores'],
        ['/content', 'Content'],
        ['/boost', 'Boost'],
        ['/subscriptions', 'Subscriptions'],
        ['/subscriptions/plans', 'Plans'],
        ['/verification', 'Verification'],
        ['/settings', 'Website settings'],
      ]
    : member
      ? [
          ['', 'Home'],
          ['/stores', 'My shops'],
          ['/products', 'Products / menu'],
          ['/posts', 'Posts'],
        ]
      : [
          ['', 'Home'],
          ['/stores', 'My stores'],
          ['/store', 'Store editor'],
          ['/design', 'Shop design'],
          ['/settings', 'Shop settings'],
          ['/verification', 'Verification'],
          ['/qr', 'QR code'],
          ['/products', 'Products / menu'],
          ['/posts', 'Posts'],
          ['/boost', 'Boost'],
          ['/plan', 'My plan'],
          ['/team', 'Team'],
        ];
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await mutate('auth/logout');
      client.clear();
      window.location.assign('/login');
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }
  return (
    <div className="panel-app">
      <a className="skip-link" href="#panel-main">
        Skip to content
      </a>
      <header className="panel-mobile-bar">
        <Link to="/" className="panel-brand notranslate">
          <img src={brandingUrl('/logo.png')} alt="" /> Matjary
        </Link>
        <button
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      {open && (
        <button
          className="panel-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`panel-sidebar ${open ? 'is-open' : ''}`}>
        <Link to="/" className="panel-brand notranslate">
          <img src={brandingUrl('/logo.png')} alt="" /> Matjary
          <span>{admin ? 'ADMIN' : 'STUDIO'}</span>
        </Link>
        <p className="panel-nav-label">
          {admin ? 'PLATFORM WORKSPACE' : 'YOUR BUSINESS, SIMPLIFIED'}
        </p>
        <nav aria-label={admin ? 'Administration' : 'Store management'}>
          {nav.map(([path, label]) => (
            <NavLink
              key={path}
              to={base + path}
              // Parent sections also own nested routes (plans, post types).
              end={
                path === '' || path === '/content' || path === '/subscriptions'
              }
              onClick={() => setOpen(false)}
            >
              <span className="notranslate">{uiText(label)}</span>
              <ArrowUpRight size={16} />
            </NavLink>
          ))}
        </nav>
        <div className="panel-sidebar-bottom">
          <Link to="/">
            Explore Matjary <ArrowUpRight size={15} />
          </Link>
          {session.isAdmin && (
            <Link to={admin ? '/dashboard' : '/admin'}>
              {admin ? 'My personal studio' : 'Admin workspace'}
            </Link>
          )}
          <div className="panel-account">
            <span className="panel-avatar">
              {session.user.displayName?.slice(0, 1) || 'M'}
            </span>
            <div>
              <strong>{session.user.displayName || 'Your account'}</strong>
              <small>{session.user.email}</small>
            </div>
          </div>
          <LanguageToggle />
          <button disabled={busy} onClick={() => void logout()}>
            <LogOut size={16} />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <main id="panel-main" className="panel-main">
        {children}
      </main>
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  // Owner-written names arrive as already-marked nodes so the translate
  // widget never rewrites a shop name inside a workspace heading.
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="panel-page-heading">
      <div>
        <p className="panel-eyebrow">{eyebrow || 'MATJARY WORKSPACE'}</p>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`panel-notice ${error ? 'is-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {!error && <Check size={18} />}
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-empty">
      <span className="panel-empty-mark">M</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="panel-loading" role="status">
      <span /> Getting everything ready…
    </div>
  );
}
export function Retry({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Notice error>
      {panelError(error)}{' '}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </Notice>
  );
}
export function Pagination({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="panel-pagination">
      <span>
        {total
          ? `${offset + 1}–${Math.min(offset + 20, total)} of ${total}`
          : 'No results'}
      </span>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 20))}
      >
        Previous
      </button>
      <button
        disabled={offset + 20 >= total}
        onClick={() => onChange(offset + 20)}
      >
        Next
      </button>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      className="panel-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          disabled={busy}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a') : null;
      if (
        link &&
        link.href !== window.location.href &&
        !window.confirm('Leave without saving your changes?')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
}
// A render failure must never leave an empty white screen: show a sanitized
// recovery panel and keep the details in the console for support.
export class PanelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Panel render failed', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel-app panel-gate">
        <div className="panel-card">
          <Empty title="This page could not be displayed">
            <p>
              Something went wrong while drawing your workspace. Nothing was
              changed — reload to try again.
            </p>
            <button
              className="panel-primary"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </Empty>
        </div>
      </div>
    );
  }
}
