import './SettingsSections.css';
import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Settings pages are long forms, so every card wears the same small header:
// an icon tile, a title, and one line that explains where the setting shows up.
// The owner workspace and the administrator workspace share these parts so the
// two halves of the product never drift apart visually.

export function SettingsSection({
  id,
  icon: Icon,
  title,
  hint,
  step,
  action,
  flush = false,
  className,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  // Owners understand a studio in a fixed order, so the design page numbers
  // its sections while the settings pages stay unnumbered.
  step?: string;
  // A small extra in the top-right corner: a count, a link, or a live sample.
  action?: ReactNode;
  // Inside a dialog the card chrome would nest boxes, so only the header stays.
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={[
        'panel-card',
        'settings-section',
        flush ? 'is-flush' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="settings-section-head">
        <span className="settings-section-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="settings-section-copy">
          <div className="settings-section-title">
            {step && <span className="settings-section-step">{step}</span>}
            <h2>{title}</h2>
          </div>
          {hint && <p className="panel-muted">{hint}</p>}
        </div>
        {action && <div className="settings-section-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function SettingsGroup({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="settings-group">
      <p className="settings-group-title">
        <span className="settings-group-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        {title}
      </p>
      {hint && <p className="settings-group-hint">{hint}</p>}
    </div>
  );
}

export function SettingsSubsection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-subsection">
      <h3 className="settings-subsection-title">
        <span className="settings-subsection-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface SettingsJumpItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

// A long settings page needs a map: a sticky strip of chips on the owner pages
// and a vertical list inside the sticky administrator sidebar. The active chip
// follows the section that currently owns the top of the viewport.
export function SettingsJump({
  items,
  label = 'On this page',
  variant = 'bar',
}: {
  items: SettingsJumpItem[];
  label?: string;
  variant?: 'bar' | 'list';
}) {
  const active = useActiveSection(items.map((item) => item.id));
  return (
    <nav
      className={`settings-jump ${variant === 'list' ? 'is-list' : ''}`}
      aria-label={label}
    >
      <p className="settings-jump-label">{label}</p>
      <div className="settings-jump-links">
        {items.map(({ id, label: itemLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`settings-jump-link ${active === id ? 'is-active' : ''}`}
            aria-current={active === id ? 'true' : undefined}
            onClick={() => jumpToSection(id)}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            {itemLabel}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function jumpToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  // An "Advanced" panel that is still collapsed would scroll to a closed box.
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  // The array is rebuilt on every render; watch its contents instead of its
  // identity so the observer is not torn down by an unrelated keystroke.
  const key = ids.join('|');
  useEffect(() => {
    const elements = key
      .split('|')
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target.id;
        if (top) setActive(top);
      },
      // Ignore the heading strip; a section counts once it reaches the top.
      { rootMargin: '-110px 0px -55% 0px', threshold: 0 },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return active;
}
