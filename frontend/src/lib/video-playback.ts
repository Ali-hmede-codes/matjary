// Autoplaying feed clips share one brake: when the post viewer opens (or the
// tab hides), every clip mounted behind it must stop and then resume where the
// viewer left off. Components subscribe through useSyncExternalStore, so the
// store stays framework-agnostic and needs no React import.

let suspensionDepth = 0;
const listeners = new Set<() => void>();

export function suspendFeedPlayback() {
  suspensionDepth += 1;
  notify();
}

export function resumeFeedPlayback() {
  suspensionDepth = Math.max(0, suspensionDepth - 1);
  notify();
}

export function isFeedPlaybackSuspended() {
  return suspensionDepth > 0;
}

export function subscribeFeedPlayback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}
