import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck, Store } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { getJson, mutate, panelError, type Session } from './panel-api';
import { Empty, Loading, Notice, Retry } from './PanelUI';

interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (result: { credential: string }) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: string; size: string; text: string; width: number },
  ): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let identityScript: Promise<void> | undefined;
function loadIdentity() {
  if (window.google) return Promise.resolve();
  return (identityScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      identityScript = undefined;
      script.remove();
      reject(new Error('Sign-in unavailable'));
    };
    document.head.append(script);
  }));
}
export function useSession(poll = true) {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => getJson<Session>('auth/me', signal),
    retry: false,
    staleTime: 30_000,
    refetchInterval: poll ? 60_000 : false,
    refetchOnWindowFocus: poll,
  });
}
export function ProtectedPanel({
  admin = false,
  children,
}: {
  admin?: boolean;
  children: (session: Session) => ReactNode;
}) {
  const query = useSession();
  const client = useQueryClient();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const old = previous.current;
    previous.current = query.data?.user.id;
    if (old && old !== query.data?.user.id) {
      void client.cancelQueries({
        predicate: (q) => q.queryKey[0] === 'panel' && q.queryKey.includes(old),
      });
      client.removeQueries({
        predicate: (q) => q.queryKey[0] === 'panel' && q.queryKey.includes(old),
      });
    }
  }, [query.data?.user.id, client]);
  if (query.isPending)
    return (
      <div className="panel-app panel-gate">
        <Loading />
      </div>
    );
  if (query.error instanceof ApiError && query.error.status === 401)
    return <Navigate to="/login" replace />;
  if (query.isError)
    return (
      <div className="panel-app panel-gate">
        <Retry error={query.error} retry={() => void query.refetch()} />
      </div>
    );
  if (admin && !query.data.isAdmin)
    return (
      <div className="panel-app panel-gate">
        <Empty title="This workspace is for administrators">
          <p>Your store tools are ready in your personal studio.</p>
          <Link className="panel-primary" to="/dashboard">
            Open my studio
          </Link>
        </Empty>
      </div>
    );
  return <div key={query.data.user.id}>{children(query.data)}</div>;
}

export function LoginPage() {
  const session = useSession(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const button = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (
      session.isPending ||
      session.data ||
      (session.isError &&
        !(session.error instanceof ApiError && session.error.status === 401))
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      active.current = true;
      setError('');
      void (async () => {
        try {
          await loadIdentity();
          if (cancelled) return;
          const challenge = await mutate<{ clientId: string; nonce: string }>(
            'auth/bootstrap',
          );
          if (cancelled || !button.current || !window.google) return;
          button.current.replaceChildren();
          window.google.accounts.id.initialize({
            client_id: challenge.clientId,
            nonce: challenge.nonce,
            callback: (result) => {
              if (!active.current) return;
              active.current = false;
              setBusy(true);
              void mutate<Session>('auth/google', {
                credential: result.credential,
              })
                .then((data) => {
                  client.clear();
                  client.setQueryData(['session'], data);
                  navigate(data.isAdmin ? '/admin' : '/dashboard', {
                    replace: true,
                  });
                })
                .catch((e) => {
                  setError(panelError(e));
                  setBusy(false);
                });
            },
          });
          window.google.accounts.id.renderButton(button.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            width: Math.min(340, button.current.clientWidth || 280),
          });
        } catch (e) {
          if (!cancelled) setError(panelError(e));
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      active.current = false;
      window.clearTimeout(timer);
      window.google?.accounts.id.cancel();
    };
  }, [
    session.isPending,
    session.isError,
    session.data,
    session.error,
    attempt,
    client,
    navigate,
  ]);
  if (session.data)
    return (
      <Navigate to={session.data.isAdmin ? '/admin' : '/dashboard'} replace />
    );
  return (
    <div className="panel-app panel-login">
      <section className="panel-login-story">
        <Link to="/" className="panel-brand">
          <img src="/logo.png" alt="" /> Matjary
        </Link>
        <div>
          <p className="panel-eyebrow">YOUR NEXT CHAPTER</p>
          <h1>
            Your business.
            <br />
            Beautifully simple.
          </h1>
          <p>
            Create a little home for what you do. Share your products, choose
            your colors, and make it yours.
          </p>
          <div className="panel-login-features">
            <span>
              <Store size={20} /> Your own store
            </span>
            <span>
              <ShieldCheck size={20} /> One secure account
            </span>
          </div>
        </div>
        <small>Made for independent businesses.</small>
      </section>
      <main className="panel-login-card">
        <p className="panel-eyebrow">WELCOME TO MATJARY</p>
        <h2>
          A fresh start,
          <br />
          or right where you left off.
        </h2>
        <p>
          Continue with Google. Your account is created automatically if you're
          new.
        </p>
        {session.isPending ? (
          <Loading />
        ) : session.isError &&
          !(
            session.error instanceof ApiError && session.error.status === 401
          ) ? (
          <Retry error={session.error} retry={() => void session.refetch()} />
        ) : (
          <>
            <div className="panel-google" ref={button} />
            {busy && <Loading />}
            {error && (
              <Notice error>
                {error}
                <button
                  disabled={busy}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Retry sign-in
                </button>
              </Notice>
            )}
          </>
        )}
        <small>
          No extra password. Your store stays yours.
          <br />
          Administrators have a separate workspace.
        </small>
        <Link to="/">Back to exploring</Link>
      </main>
    </div>
  );
}
