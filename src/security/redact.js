// Data-minimisation helpers for anything that leaves the browser or is kept locally.

/**
 * Source URL suitable for a commit message or the local index.
 * Default: origin + path only. Query strings and fragments often carry session, reset or
 * share tokens, so they are dropped unless the user opts in. Credentials are always removed.
 * Non-web URLs (file:, data:, chrome-extension:, …) are reduced to their scheme.
 */
export function redactSourceUrl(raw, { keepQuery = false } = {}) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return u.protocol ? `${u.protocol}…` : '';
  u.username = '';
  u.password = '';
  if (!keepQuery) { u.search = ''; u.hash = ''; }
  return u.toString();
}

export function hostOf(raw) {
  try { return new URL(String(raw || '')).hostname.replace(/^www\./, ''); } catch { return ''; }
}
