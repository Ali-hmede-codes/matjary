import type { ReactNode } from 'react';
import { Bookmark } from 'lucide-react';

export function StatusBanner({
  children,
  action,
  onAction,
  icon,
  demo = false,
}: {
  children: ReactNode;
  action: ReactNode;
  onAction: () => void;
  icon?: ReactNode;
  demo?: boolean;
}) {
  return (
    <div className={`status-banner ${demo ? 'demo-banner' : ''}`} role="status">
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
