// Stable, non-sensitive business codes the API may return for subscription
// state. The exception filter passes only allowlisted values through, so
// adding a code here deliberately makes it client-visible.
export const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';
export const FREE_TRIAL_CAP_CODE = 'FREE_TRIAL_CAP';

export const SAFE_SUBSCRIPTION_CODES: ReadonlySet<string> = new Set([
  TRIAL_EXPIRED_CODE,
  FREE_TRIAL_CAP_CODE,
]);
