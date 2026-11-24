// Local capture index: metadata about captures and the GitHub operations that followed.
// GitHub stays the source of truth for file contents and history; this index only remembers
// what the user did so they can find it again. Excerpts are optional, short, and never kept
// for content the secret scanner flagged.

export const INDEX_KEY = 'captureIndex';
const LEGACY_HISTORY_KEY = 'history';
export const MAX_ENTRIES = 500;
export const EXCERPT_CHARS = 500;

/** Lifecycle states. Only 'uploaded' / 'updated' / 'restored' mean GitHub confirmed a commit. */
export const STATUS = {
  captured: 'Captured locally',
  pending: 'Pending upload',
  uploaded: 'Uploaded',
  updated: 'Updated on GitHub',
  restored: 'Restored on GitHub',
  duplicate: 'Already on GitHub',
  failed: 'Failed',
  conflict: 'Conflict detected',
};
export const CONFIRMED = new Set(['uploaded', 'updated', 'restored', 'duplicate']);

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeExcerpt(text, { enabled = true, hasSecrets = false } = {}) {
  if (!enabled || hasSecrets) return '';
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
}

/** Pure helpers (unit-tested). */
export function upsert(entries, entry, max = MAX_ENTRIES) {
  const i = entries.findIndex((e) => e.id === entry.id);
  const next = entries.slice();
  if (i >= 0) next[i] = { ...next[i], ...entry, updatedAt: entry.updatedAt || new Date().toISOString() };
  else next.unshift({ createdAt: new Date().toISOString(), ...entry, updatedAt: entry.updatedAt || new Date().toISOString() });
  next.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return next.slice(0, max);
}

export function search(entries, { q = '', category = '', repo = '', status = '' } = {}) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (category && e.category !== category) return false;
    if (repo && e.repo !== repo) return false;
    if (status === 'confirmed' && !CONFIRMED.has(e.status)) return false;
    if (status === 'local' && CONFIRMED.has(e.status)) return false;
    if (!terms.length) return true;
    const hay = [e.title, e.excerpt, e.category, e.language, e.sourceHost, e.repo, e.path, ...(e.tags || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function findDuplicates(entries, contentHash, excludeId) {
  if (!contentHash) return [];
  return entries.filter((e) => e.contentHash === contentHash && e.id !== excludeId && CONFIRMED.has(e.status));
}

/** Converts v0.1 "recent saves" records into index entries (one-time migration). */
export function migrateLegacy(legacy) {
  return (Array.isArray(legacy) ? legacy : []).map((h, i) => ({
    id: `legacy-${i}-${h.savedAt || ''}`,
    status: 'uploaded',
    title: (h.path || '').split('/').pop(),
    repo: h.repo || '',
    branch: h.branch || '',
    path: h.path || '',
    htmlUrl: h.url || '',
    sourceHost: (() => { try { return new URL(h.sourceUrl).hostname; } catch { return ''; } })(),
    category: '',
    tags: [],
    createdAt: h.savedAt || '',
    updatedAt: h.savedAt || '',
  }));
}

// ---- chrome.storage wrappers ----
let writeChain = Promise.resolve();

export async function getIndex() {
  const got = await chrome.storage.local.get([INDEX_KEY, LEGACY_HISTORY_KEY]);
  if (Array.isArray(got[INDEX_KEY])) return got[INDEX_KEY];
  const migrated = migrateLegacy(got[LEGACY_HISTORY_KEY]);
  await chrome.storage.local.set({ [INDEX_KEY]: migrated });
  await chrome.storage.local.remove(LEGACY_HISTORY_KEY);
  return migrated;
}

/** Serialised read-modify-write so concurrent updates from one page do not clobber each other. */
export function recordEntry(entry) {
  writeChain = writeChain.then(async () => {
    const entries = await getIndex();
    await chrome.storage.local.set({ [INDEX_KEY]: upsert(entries, entry) });
  }).catch(() => {});
  return writeChain;
}

export async function removeEntry(id) {
  const entries = await getIndex();
  await chrome.storage.local.set({ [INDEX_KEY]: entries.filter((e) => e.id !== id) });
}

export async function clearIndex() {
  await chrome.storage.local.set({ [INDEX_KEY]: [] });
  await chrome.storage.local.remove(LEGACY_HISTORY_KEY);
}
