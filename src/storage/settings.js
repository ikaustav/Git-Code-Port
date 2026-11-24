// Settings, token and repository-cache storage. Capture history lives in src/history/index.js.
//
// AUTH MODEL: the user supplies their own fine-grained personal access token (PAT).
// By default the token lives in chrome.storage.session (memory only, cleared when the browser
// closes, and not readable by content scripts). If the user ticks "Remember", it is also kept in
// chrome.storage.local, which is NOT encrypted at rest. See README "Security and privacy" for the
// limitations and why a GitHub App / OAuth device flow is the better long-term model.

const TOKEN_KEY = 'githubToken';

export const DEFAULT_SETTINGS = {
  defaultRepo: '', // "owner/name"
  defaultBranch: '', // empty = repo default branch
  folderTemplate: '{language}',
  addSourceHeader: false,
  includeSourceInCommit: true,
  fullSourceUrl: false, // false: origin + path only (query strings can contain tokens)
  storeExcerpts: true, // short excerpts in the local index for search; never for flagged content
  categoryFolders: {}, // { [categoryId]: folder template } overrides
  repoDefaults: {}, // { "owner/name": { branch, baseFolder } }
  theme: 'system', // system | light | dark
  rememberToken: false,
  githubLogin: '',
  lastRepo: '',
  lastBranch: '',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getToken() {
  const s = await chrome.storage.session.get(TOKEN_KEY);
  if (s[TOKEN_KEY]) return s[TOKEN_KEY];
  const l = await chrome.storage.local.get(TOKEN_KEY);
  if (l[TOKEN_KEY]) {
    // Keep a session copy so later reads are cheap.
    await chrome.storage.session.set({ [TOKEN_KEY]: l[TOKEN_KEY] });
    return l[TOKEN_KEY];
  }
  return '';
}

export async function setToken(token, remember) {
  await chrome.storage.session.set({ [TOKEN_KEY]: token });
  if (remember) await chrome.storage.local.set({ [TOKEN_KEY]: token });
  else await chrome.storage.local.remove(TOKEN_KEY);
}

export async function clearToken() {
  await chrome.storage.session.remove(TOKEN_KEY);
  await chrome.storage.local.remove(TOKEN_KEY);
  await chrome.storage.local.remove('repoCache');
  await saveSettings({ githubLogin: '' });
}

// Short-lived repo list cache (spec 9: cache carefully, refresh on demand).
const REPO_TTL_MS = 10 * 60 * 1000;

export async function getCachedRepos() {
  const { repoCache } = await chrome.storage.local.get('repoCache');
  if (repoCache && Date.now() - repoCache.at < REPO_TTL_MS) return repoCache.repos;
  return null;
}

export async function setCachedRepos(repos) {
  await chrome.storage.local.set({ repoCache: { at: Date.now(), repos } });
}
