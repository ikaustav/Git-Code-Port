// Side panel workspace: Home, Explore, Capture, History, Repositories, Settings.
// All content from pages, GitHub and local history is rendered with textContent only.
// GitHub writes from here are limited to "restore an earlier version", which needs an explicit
// confirmation that shows repository, branch, path, current state and the proposed action.

import { getSettings, saveSettings, getToken, clearToken, getCachedRepos, setCachedRepos } from '../storage/settings.js';
import { GitHubClient, GitHubError, safeGitHubUrl } from '../github/api.js';
import { getIndex, search, recordEntry, removeEntry, clearIndex, STATUS, CONFIRMED, INDEX_KEY, sha256Hex } from '../history/index.js';
import { CATEGORIES, categoryById } from '../classifier/categories.js';
import { assessToken } from '../security/token.js';
import { renderDiff } from '../ui/diff-view.js';
import { applyTheme } from '../ui/theme.js';
import { EXPLORE, QUICK_ACTIONS } from './explore.js';

const $ = (id) => document.getElementById(id);
const SIDE_PANEL_ORIGINS = ['https://*/*', 'http://*/*'];
const state = { settings: null, client: null, login: '', entries: [], current: null, views: new Set(), granted: false };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function toast(message, kind = 'ok') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// ---------- confirmation dialog ----------
function confirmDialog({ title, body, ok, checkLabel = '', danger = false }) {
  const dlg = $('confirm-dialog');
  $('cd-title').textContent = title;
  const b = $('cd-body');
  b.replaceChildren(...(Array.isArray(body) ? body : [el('p', { text: body })]));
  $('cd-ok').textContent = ok;
  $('cd-ok').className = `btn small ${danger ? 'danger' : 'primary'}`;
  $('cd-check-row').hidden = !checkLabel;
  $('cd-check-label').textContent = checkLabel;
  $('cd-check').checked = false;
  $('cd-ok').disabled = !!checkLabel;
  $('cd-check').onchange = () => { $('cd-ok').disabled = !$('cd-check').checked; };
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.returnValue = 'cancel';
    dlg.showModal();
  });
}

// ---------- tabs ----------
const VIEWS = ['home', 'explore', 'capture', 'history', 'repos', 'settings'];
function showView(name) {
  for (const v of VIEWS) {
    const selected = v === name;
    $(`view-${v}`).hidden = !selected;
    $(`tab-${v}`).setAttribute('aria-selected', String(selected));
    $(`tab-${v}`).tabIndex = selected ? 0 : -1;
  }
  if (name === 'history') renderHistory();
  if (name === 'repos' && !state.views.has('repos')) loadRepos(false);
  if (name === 'settings' && !state.views.has('settings')) renderSettings(true);
  if (name === 'capture') refreshPermission();
  state.views.add(name);
}

function wireTabs() {
  const tabs = VIEWS.map((v) => $(`tab-${v}`));
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showView(VIEWS[i]));
    t.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      showView(VIEWS[(i + d + tabs.length) % tabs.length]);
    });
  });
  document.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-goto]');
    if (go) showView(go.getAttribute('data-goto'));
    if (ev.target.closest('[data-open-options]')) chrome.runtime.openOptionsPage();
  });
}

// ---------- connection ----------
async function connect() {
  const token = await getToken();
  state.client = token ? new GitHubClient(token) : null;
  state.login = state.settings.githubLogin || '';
  const connected = !!state.client;
  $('conn-dot').className = `dot ${connected ? 'on' : 'off'}`;
  $('conn-dot').setAttribute('aria-label', connected ? 'Connected to GitHub' : 'Not connected');
  $('home-account').textContent = connected ? `Connected to GitHub${state.login ? ` as @${state.login}` : ''}.` : 'Not connected. Add a fine-grained token to start saving to GitHub.';
  $('home-connect').hidden = connected;
  $('home-default-repo').textContent = state.settings.defaultRepo || 'not set (choose one in Repos)';
}

// ---------- capture ----------
function renderQuickActions() {
  for (const grid of document.querySelectorAll('[data-quick-actions]')) {
    grid.replaceChildren(...QUICK_ACTIONS.map((a) => {
      const btn = el('button', { type: 'button', class: 'quick', 'data-category': a.category },
        el('strong', { text: a.label }), el('span', { class: 'muted small', text: a.hint }));
      btn.addEventListener('click', () => quickCapture(a.category, grid.parentElement.querySelector('.capture-result')));
      return btn;
    }));
  }
}

async function hasCapturePermission() {
  try { return await chrome.permissions.contains({ origins: SIDE_PANEL_ORIGINS }); } catch { return false; }
}

async function refreshPermission() {
  const granted = await hasCapturePermission();
  state.granted = granted;
  $('perm-card').hidden = granted;
  $('s-perm').textContent = granted ? 'on' : 'off';
  $('s-perm-revoke').hidden = !granted;
  return granted;
}

async function requestPermission() {
  // Must run directly in the click handler (user gesture) for Chrome to show the prompt.
  try { return await chrome.permissions.request({ origins: SIDE_PANEL_ORIGINS }); } catch { return false; }
}

async function quickCapture(category, resultEl) {
  const show = (msg) => { if (resultEl) { resultEl.textContent = msg; resultEl.hidden = !msg; } };
  show('');
  // The permission prompt needs the click's user gesture, so it is the first await here.
  let granted = state.granted;
  if (!granted) granted = await requestPermission();
  await refreshPermission();
  if (!granted) {
    show('Side-panel capture needs permission. Use the right-click menu instead, or allow it in the Capture tab.');
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'capture-active-tab', category });
    show(res && res.ok ? '' : (res && res.error) || 'Could not capture the selection.');
    if (res && res.ok) toast('Opened the review window. Nothing is saved until you confirm there.');
  } catch {
    show('Could not capture the selection. Reload the page and try again.');
  }
}

// ---------- explore ----------
function renderExplore() {
  $('explore-list').replaceChildren(...EXPLORE.map((g) => {
    const btn = el('button', { type: 'button', class: 'btn small', text: g.action });
    const result = el('p', { class: 'capture-result small', role: 'alert', hidden: true });
    btn.addEventListener('click', () => quickCapture(g.category, result));
    return el('article', { class: 'card' },
      el('h2', { text: g.title }),
      el('p', { class: 'small muted', text: g.sites }),
      el('ul', { class: 'small' }, ...g.items.map((t) => el('li', { text: t }))),
      el('div', { class: 'actions left' }, btn, el('span', { class: 'small muted', text: `Suggested category: ${categoryById[g.category].name}` })),
      result);
  }));
}

// ---------- history ----------
function statusBadge(status) {
  return el('span', { class: `badge s-${status}`, text: STATUS[status] || status });
}

function entryRow(e) {
  const li = el('li');
  const btn = el('button', { type: 'button', class: 'entry' },
    el('span', { class: 'entry-title', text: e.path ? e.path.split('/').pop() : (e.title || '(untitled)') }),
    el('span', { class: 'entry-meta small muted', text: [e.repo, (categoryById[e.category] || {}).name, e.sourceHost, fmtDate(e.updatedAt)].filter(Boolean).join(' · ') }),
    statusBadge(e.status));
  btn.addEventListener('click', () => openDetail(e.id));
  li.append(btn);
  return li;
}

async function loadEntries() {
  state.entries = await getIndex();
  return state.entries;
}

function renderRecent() {
  const list = $('home-recent');
  const items = state.entries.slice(0, 5);
  list.replaceChildren(...(items.length ? items.map(entryRow) : [el('li', { class: 'empty small muted', text: 'Nothing captured yet. Select something on a page and right-click it.' })]));
}

function fillHistoryFilters() {
  const cat = $('h-category');
  if (cat.options.length === 1) for (const c of CATEGORIES) cat.append(el('option', { value: c.id, text: c.name }));
  const repoSel = $('h-repo');
  const current = repoSel.value;
  const repos = [...new Set(state.entries.map((e) => e.repo).filter(Boolean))].sort();
  repoSel.replaceChildren(el('option', { value: '', text: 'All repositories' }), ...repos.map((r) => el('option', { value: r, text: r })));
  repoSel.value = repos.includes(current) ? current : '';
}

function renderHistory() {
  fillHistoryFilters();
  const results = search(state.entries, { q: $('h-search').value, category: $('h-category').value, repo: $('h-repo').value, status: $('h-status').value });
  $('h-count').textContent = state.entries.length ? `${results.length} of ${state.entries.length} entries` : '';
  $('h-list').replaceChildren(...(results.length ? results.slice(0, 200).map(entryRow)
    : [el('li', { class: 'empty small muted', text: state.entries.length ? 'No matches. Try another word or clear the filters.' : 'History is empty. Captures and uploads appear here.' })]));
}

async function openDetail(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  state.current = e;
  showView('history');
  $('history-list-view').hidden = true;
  $('history-detail').hidden = false;
  $('d-title').textContent = e.path ? e.path.split('/').pop() : (e.title || '(untitled)');
  $('d-status').replaceWith(Object.assign(statusBadge(e.status), { id: 'd-status' }));
  $('d-category').textContent = (categoryById[e.category] || {}).name || '';
  $('d-repo').textContent = e.repo || '—';
  $('d-branch').textContent = e.branch || '—';
  $('d-path').textContent = e.path || '—';
  const commitUrl = safeGitHubUrl(e.commitUrl);
  const commit = $('d-commit');
  commit.replaceChildren();
  if (e.commitSha && commitUrl) commit.append(el('a', { href: commitUrl, target: '_blank', rel: 'noopener noreferrer', text: e.commitSha.slice(0, 7) }));
  else commit.textContent = e.commitSha ? e.commitSha.slice(0, 7) : (CONFIRMED.has(e.status) ? 'not recorded' : 'no commit');
  $('d-tags').textContent = (e.tags || []).join(', ') || '—';
  $('d-language').textContent = e.language && e.language !== 'text' ? e.language : '—';
  $('d-source').textContent = e.sourceUrl || e.sourceHost || '—';
  $('d-captured').textContent = fmtDate(e.capturedAt || e.createdAt) || '—';
  $('d-updated').textContent = fmtDate(e.updatedAt) || '—';
  $('d-error').textContent = e.error || '';
  $('d-error').hidden = !e.error || e.status !== 'failed';
  $('d-excerpt').textContent = e.excerpt || '';
  $('d-excerpt').hidden = !e.excerpt;
  const href = safeGitHubUrl(e.htmlUrl);
  $('d-open').hidden = !href;
  if (href) $('d-open').href = href;
  $('d-versions-btn').hidden = !(e.repo && e.path && e.branch && CONFIRMED.has(e.status));
  $('d-versions').hidden = true;
  const live = (await chrome.storage.session.get(`capture:${e.id}`))[`capture:${e.id}`];
  $('d-resume').hidden = !live || CONFIRMED.has(e.status);
}

function closeDetail() {
  state.current = null;
  $('history-detail').hidden = true;
  $('history-list-view').hidden = false;
  renderHistory();
}

async function showVersions() {
  const e = state.current;
  if (!state.client) { toast('Connect GitHub first.', 'bad'); return; }
  $('d-versions').hidden = false;
  $('d-compare').hidden = true;
  $('d-versions-status').textContent = 'Loading versions…';
  $('d-versions-list').replaceChildren();
  try {
    const commits = await state.client.listFileCommits(e.repo, e.path, e.branch);
    $('d-versions-status').textContent = commits.length ? `${commits.length} version${commits.length === 1 ? '' : 's'} on ${e.branch} (newest first).` : 'No commits found for this file on that branch. It may have been moved or deleted.';
    $('d-versions-list').replaceChildren(...commits.map((c, i) => {
      const compare = el('button', { type: 'button', class: 'link-btn small', text: i === 0 ? 'Current' : 'Compare with current' });
      compare.disabled = i === 0;
      compare.addEventListener('click', () => compareVersion(c));
      const restore = el('button', { type: 'button', class: 'link-btn small danger-text', text: 'Restore…', hidden: i === 0 });
      restore.addEventListener('click', () => restoreVersion(c));
      const link = c.htmlUrl ? el('a', { href: c.htmlUrl, target: '_blank', rel: 'noopener noreferrer', text: c.sha.slice(0, 7) }) : el('code', { text: c.sha.slice(0, 7) });
      return el('li', {},
        el('div', {}, link, el('span', { class: 'small', text: ` ${c.message}` })),
        el('div', { class: 'small muted', text: [c.author, fmtDate(c.date)].filter(Boolean).join(' · ') }),
        el('div', { class: 'actions left tight' }, compare, restore));
    }));
  } catch (err) {
    $('d-versions-status').textContent = err instanceof GitHubError ? err.message : 'Could not load versions.';
  }
}

async function loadPair(c) {
  const e = state.current;
  const [old, current] = await Promise.all([
    state.client.getFile(e.repo, e.path, c.sha),
    state.client.getFile(e.repo, e.path, e.branch),
  ]);
  return { old, current };
}

async function compareVersion(c) {
  $('d-compare').hidden = false;
  $('d-compare-title').textContent = `Changes from ${c.sha.slice(0, 7)} to the current file`;
  $('d-compare-diff').textContent = 'Loading…';
  try {
    const { old, current } = await loadPair(c);
    if (!old || !current || old.content === null || current.content === null) {
      $('d-compare-diff').textContent = 'One of the versions is missing, too large or binary, so it cannot be compared here.';
      return;
    }
    renderDiff($('d-compare-diff'), old.content, current.content);
  } catch (err) {
    $('d-compare-diff').textContent = err instanceof GitHubError ? err.message : 'Could not compare versions.';
  }
}

async function restoreVersion(c) {
  const e = state.current;
  let pair;
  try { pair = await loadPair(c); } catch (err) { toast(err instanceof GitHubError ? err.message : 'Could not load the file.', 'bad'); return; }
  const { old, current } = pair;
  if (!old || old.content === null || !old.isFile) { toast('That version cannot be restored here (missing, too large or binary).', 'bad'); return; }
  if (current && !current.isFile) { toast('The path is now a folder, so it cannot be restored.', 'bad'); return; }
  if (current && current.content === old.content) { toast('The current file already matches that version. Nothing to restore.'); return; }
  const diff = el('div');
  if (current && current.content !== null) renderDiff(diff, current.content, old.content);
  const ok = await confirmDialog({
    title: 'Restore an earlier version?',
    body: [
      el('dl', { class: 'kv' },
        el('dt', { text: 'Repository' }), el('dd', { text: e.repo }),
        el('dt', { text: 'Branch' }), el('dd', { text: e.branch }),
        el('dt', { text: 'File' }), el('dd', { class: 'break', text: e.path }),
        el('dt', { text: 'Current file' }), el('dd', { text: current ? `exists (${String(current.sha).slice(0, 7)})` : 'deleted; it will be re-created' }),
        el('dt', { text: 'Action' }), el('dd', { text: `New commit with the content of ${c.sha.slice(0, 7)}. History is kept.` })),
      el('p', { class: 'small muted', text: 'Changes compared with the current file:' }),
      diff,
    ],
    ok: 'Restore',
    checkLabel: 'I want to replace the current file with this version',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await state.client.putFile(e.repo, e.path, {
      content: old.content,
      message: `Restore ${e.path.split('/').pop()} to ${c.sha.slice(0, 7)}\n\nRestored from commit ${c.sha}\nSaved with Git Code Port`,
      branch: e.branch,
      sha: current ? current.sha : undefined,
    });
    await recordEntry({ ...e, status: 'restored', commitSha: res.commitSha, commitUrl: res.commitUrl, htmlUrl: res.htmlUrl || e.htmlUrl, contentHash: await sha256Hex(old.content), error: '' });
    toast(`Restored. New commit ${res.commitSha.slice(0, 7)}.`);
    await loadEntries();
    await openDetail(e.id);
    await showVersions();
  } catch (err) {
    toast(err instanceof GitHubError ? err.message : 'Restore failed. Nothing was changed.', 'bad');
  }
}

function wireHistory() {
  let t;
  $('h-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderHistory, 120); });
  for (const id of ['h-category', 'h-repo', 'h-status']) $(id).addEventListener('change', renderHistory);
  $('d-back').addEventListener('click', closeDetail);
  $('d-versions-btn').addEventListener('click', showVersions);
  $('d-resume').addEventListener('click', async () => {
    const id = state.current.id;
    await chrome.windows.create({ url: chrome.runtime.getURL(`src/review/review.html?id=${encodeURIComponent(id)}`), type: 'popup', width: 860, height: 920 });
  });
  $('d-remove').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remove from history?', body: 'This only removes the entry from this browser. The file on GitHub is not touched.', ok: 'Remove', danger: true });
    if (!ok) return;
    await removeEntry(state.current.id);
    await loadEntries();
    closeDetail();
    renderRecent();
  });
}

// ---------- repositories ----------
async function loadRepos(force) {
  const list = $('r-list');
  if (!state.client) {
    $('r-status').textContent = 'Connect GitHub to see your repositories.';
    list.replaceChildren();
    return;
  }
  $('r-status').textContent = 'Loading repositories…';
  try {
    let repos = force ? null : await getCachedRepos();
    if (!repos) { repos = await state.client.listRepos(); await setCachedRepos(repos); }
    $('r-status').textContent = repos.length ? `${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'} with write access.` : 'No repositories with write access. Check the token\'s repository access on GitHub.';
    list.replaceChildren(...repos.map(repoRow));
  } catch (err) {
    $('r-status').textContent = err instanceof GitHubError ? err.message : 'Could not load repositories.';
  }
}

function repoRow(r) {
  const s = state.settings;
  const defaults = (s.repoDefaults || {})[r.fullName] || {};
  const isDefault = s.defaultRepo === r.fullName;
  const setDefault = el('button', { type: 'button', class: `btn small ${isDefault ? '' : 'primary'}`, text: isDefault ? 'Default ✓' : 'Make default' });
  setDefault.disabled = isDefault;
  setDefault.addEventListener('click', async () => {
    state.settings = await saveSettings({ defaultRepo: r.fullName });
    toast(`${r.fullName} is now the default repository.`);
    await connect();
    loadRepos(false);
  });
  const branch = el('input', { type: 'text', value: defaults.branch || '', placeholder: r.defaultBranch, spellcheck: false });
  const base = el('input', { type: 'text', value: defaults.baseFolder || '', placeholder: '(repository root)', spellcheck: false });
  const err = el('p', { class: 'bad-text small', hidden: true });
  const save = el('button', { type: 'button', class: 'btn small', text: 'Save' });
  save.addEventListener('click', async () => {
    const b = branch.value.trim();
    const f = base.value.trim().replace(/^\/+|\/+$/g, '');
    const problems = [];
    if (b && /(^\/|\/$|\.\.|\/\/|@\{|[\u0000- ~^:?*[\\\u007f]|\.lock$|^\.|\.$)/.test(b)) problems.push('Branch name is not valid.');
    if (f && (/(^|\/)\.\.?(\/|$)/.test(f) || /[\\:*?"<>|\u0000-\u001f]/.test(f))) problems.push('Folder contains characters or segments that are not allowed.');
    err.textContent = problems.join(' ');
    err.hidden = !problems.length;
    if (problems.length) return;
    const repoDefaults = { ...(state.settings.repoDefaults || {}) };
    if (b || f) repoDefaults[r.fullName] = { branch: b, baseFolder: f }; else delete repoDefaults[r.fullName];
    state.settings = await saveSettings({ repoDefaults });
    toast(`Saved defaults for ${r.fullName}.`);
  });
  return el('li', { class: 'repo' },
    el('div', { class: 'repo-head' },
      el('strong', { class: 'break', text: r.fullName }),
      el('span', { class: 'small muted', text: `${r.private ? 'private' : 'public'} · default branch ${r.defaultBranch}` }),
      setDefault),
    el('details', { class: 'small' }, el('summary', { text: 'Repository defaults' }),
      el('label', { class: 'field' }, el('span', { text: 'Branch to save to' }), branch),
      el('label', { class: 'field' }, el('span', { text: 'Base folder (prefix for suggestions)' }), base),
      err, el('div', { class: 'actions left' }, save)));
}

// ---------- settings ----------
async function renderSettings(checkToken) {
  const s = state.settings;
  $('s-folder-code').value = (s.categoryFolders || {}).code ?? s.folderTemplate;
  const box = $('s-cat-folders');
  box.replaceChildren(...CATEGORIES.filter((c) => c.id !== 'code').map((c) => el('label', { class: 'field' },
    el('span', { text: c.name }),
    el('input', { type: 'text', 'data-cat': c.id, value: (s.categoryFolders || {})[c.id] ?? c.folder, spellcheck: false }))));
  $('s-source-commit').checked = s.includeSourceInCommit !== false;
  $('s-full-url').checked = !!s.fullSourceUrl;
  $('s-excerpts').checked = s.storeExcerpts !== false;
  $('s-theme').value = s.theme || 'system';
  $('s-count').textContent = String(state.entries.length);
  await refreshPermission();
  if (checkToken) await checkConnection();
}

async function checkConnection() {
  const out = $('s-account');
  const warn = $('s-token-warnings');
  warn.replaceChildren();
  warn.hidden = true;
  const token = await getToken();
  if (!token) { out.textContent = 'Not connected. Use "Manage token" to connect a fine-grained personal access token.'; $('s-disconnect').hidden = true; return; }
  $('s-disconnect').hidden = false;
  out.textContent = 'Checking…';
  try {
    const { user, headers } = await new GitHubClient(token).getUserAndTokenInfo();
    const info = assessToken(token, headers);
    if (user && user.login && user.login !== state.settings.githubLogin) state.settings = await saveSettings({ githubLogin: user.login });
    out.textContent = `Connected as @${user.login} · ${info.label}${info.expiresAt ? ` · expires ${new Date(info.expiresAt).toLocaleDateString()}` : ''}.`;
    warn.replaceChildren(...info.warnings.map((w) => el('li', { text: w })));
    warn.hidden = info.warnings.length === 0;
  } catch (err) {
    out.textContent = err instanceof GitHubError ? err.message : 'Could not check the connection.';
  }
}

function wireSettings() {
  $('s-check').addEventListener('click', checkConnection);
  $('s-disconnect').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Disconnect GitHub?', body: 'The token is removed from this browser. To invalidate it everywhere, also delete it on GitHub (Settings → Developer settings → Personal access tokens).', ok: 'Disconnect', danger: true });
    if (!ok) return;
    await clearToken();
    state.settings = await getSettings();
    await connect();
    await renderSettings(true);
    toast('Disconnected. The token was removed from this browser.');
  });
  $('s-perm-revoke').addEventListener('click', async () => {
    try { await chrome.permissions.remove({ origins: SIDE_PANEL_ORIGINS }); } catch { /* ignore */ }
    await refreshPermission();
    toast('Side-panel capture turned off.');
  });
  $('perm-grant').addEventListener('click', async () => {
    const granted = await requestPermission();
    await refreshPermission();
    toast(granted ? 'Side-panel capture allowed.' : 'Permission not granted.', granted ? 'ok' : 'bad');
  });
  $('s-clear').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear history?', body: 'All local history entries in this browser are deleted. Your files and commits on GitHub are not affected.', ok: 'Clear history', danger: true });
    if (!ok) return;
    await clearIndex();
    await loadEntries();
    renderRecent();
    $('s-count').textContent = '0';
    toast('History cleared.');
  });
  $('s-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const categoryFolders = {};
    const problems = [];
    const check = (v, name) => { if (/(^|\/)\.\.?(\/|$)|\\/.test(v)) problems.push(`${name}: folder must not contain "..", "." or "\\".`); };
    const code = $('s-folder-code').value.trim();
    check(code, 'Code');
    for (const input of $('s-cat-folders').querySelectorAll('input[data-cat]')) {
      const v = input.value.trim();
      check(v, categoryById[input.dataset.cat].name);
      if (v !== categoryById[input.dataset.cat].folder) categoryFolders[input.dataset.cat] = v;
    }
    $('s-form-error').textContent = problems.join(' ');
    $('s-form-error').hidden = !problems.length;
    if (problems.length) return;
    state.settings = await saveSettings({
      folderTemplate: code,
      categoryFolders,
      includeSourceInCommit: $('s-source-commit').checked,
      fullSourceUrl: $('s-full-url').checked,
      storeExcerpts: $('s-excerpts').checked,
      theme: $('s-theme').value,
    });
    applyTheme(state.settings.theme);
    toast('Settings saved.');
  });
}

// ---------- init ----------
async function init() {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  wireTabs();
  renderQuickActions();
  renderExplore();
  wireHistory();
  wireSettings();
  await connect();
  await loadEntries();
  await refreshPermission();
  chrome.permissions.onAdded.addListener(refreshPermission);
  chrome.permissions.onRemoved.addListener(refreshPermission);
  renderRecent();
  showView('home');
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'capture-selection');
    $('shortcut').textContent = (cmd && cmd.shortcut) || 'not set (chrome://extensions/shortcuts)';
  } catch { /* keep default */ }

  // Live updates when the review window records a capture or a push.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[INDEX_KEY]) {
      state.entries = changes[INDEX_KEY].newValue || [];
      renderRecent();
      if (!$('view-history').hidden && $('history-detail').hidden) renderHistory();
      $('s-count').textContent = String(state.entries.length);
    }
    if (changes.settings) { state.settings = await getSettings(); await connect(); }
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'session' && changes.githubToken) { await connect(); }
  });
}

init();
