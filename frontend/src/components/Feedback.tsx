import type { ReactNode } from 'react';
import { Bookmark } from 'lucide-react';

export function StatusBanner({
  children,
  action,
  onAction,
  icon,
}: {
  children: ReactNode;
  action: ReactNode;
  onAction: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="status-banner" role="status">
      {icon}
      <span>{children}</span>
      <button onClick={onAction}>{action}</button>
    </div>
  );
}

export function LoadingBar() {
  return (
    <div className="loading-bar" role="status">
      <span className="sr-only">Loading your discoveries…</span>
    </div>
  );
}

// Route fallback for lazily loaded screens (shops, pricing, panels). It lives
// with the feed's own styles so the panel stylesheet can stay in the panel
// chunks instead of blocking the first paint of the discovery page.
export function RouteLoading() {
  return (
    <div className="route-loading" role="status">
      <span aria-hidden="true" />
      Getting everything ready…
    </div>
  );
}

export function Toast({
  message,
  icon,
}: {
  message: string;
  icon?: ReactNode;
}) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {icon ?? <Bookmark size={16} />}
      {message}
    </div>
  );
}
