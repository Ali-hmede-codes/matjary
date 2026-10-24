import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, Check, LogOut, Menu, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { mutate, panelError, type Session } from './panel-api';

export function PanelShell({
  session,
  admin,
  children,
}: {
  session: Session;
  admin?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const base = admin ? '/admin' : '/dashboard';
  const nav = admin
    ? [
        ['', 'Overview'],
        ['/users', 'Users'],
        ['/stores', 'Stores'],
        ['/content', 'Content'],
        ['/subscriptions', 'Subscriptions'],
        ['/verification', 'Verification'],
      ]
    : [
        ['', 'Home'],
        ['/store', 'My store'],
        ['/products', 'Products / menu'],
        ['/posts', 'Posts'],
        ['/plan', 'My plan'],
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
        <Link to="/" className="panel-brand">
          <img src="/logo.png" alt="" /> Matjary
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
        <Link to="/" className="panel-brand">
          <img src="/logo.png" alt="" /> Matjary
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
              end={path === ''}
              onClick={() => setOpen(false)}
            >
              <span>{label}</span>
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
  eyebrow?: string;
  title: string;
  description?: string;
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
