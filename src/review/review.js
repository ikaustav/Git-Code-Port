// Review → confirm → push flow. Captured page text is untrusted: it is only ever placed into
// form values or textContent, never innerHTML, and never executed.

import { LANGUAGES, languageFromExtension } from '../processing/languages.js';
import { suggestFilename, suggestFolder, suggestCommitMessage, metadataTrailer, sourceHeader, platformFromUrl, FOLDER_PRESETS } from '../processing/filename.js';
import { scanForSecrets } from '../processing/secret-scan.js';
import { validatePath, validateBranch, validateContent, joinPath, nextAvailableName, sanitizeFilename } from '../utils/validation.js';
import { normalizeNewlines } from '../utils/encoding.js';
import { GitHubClient, GitHubError } from '../github/api.js';
import { getSettings, saveSettings, getToken, getCachedRepos, setCachedRepos } from '../storage/settings.js';
import { CATEGORIES, categoryById, FORMATS, formatContent } from '../classifier/categories.js';
import { classify, expandCategoryTokens, suggestTextFilename, suggestTags, parseTags } from '../classifier/classify.js';
import { recordEntry, getIndex, findDuplicates, sha256Hex, makeExcerpt } from '../history/index.js';
import { redactSourceUrl, hostOf } from '../security/redact.js';
import { renderDiff } from '../ui/diff-view.js';
import { applyTheme } from '../ui/theme.js';

const $ = (id) => document.getElementById(id);
const state = {
  capture: null,
  settings: null,
  client: null,
  repos: [],
  edited: { filename: false, folder: false, commit: false, format: false, tags: false },
  target: null, // { repo, branch, path, content, message }
  existing: null, // { sha, content }
  secrets: [],
};

// ---------- screens ----------
const SCREENS = ['review', 'confirm', 'working', 'conflict', 'notfile', 'success', 'error', 'missing'];
const STEP_OF = { review: 'review', confirm: 'confirm', working: 'confirm', conflict: 'confirm', notfile: 'review', error: 'confirm', success: 'done', missing: 'review' };
function show(name) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  const step = STEP_OF[name];
  for (const li of document.querySelectorAll('#stepper li')) {
    li.classList.toggle('active', li.dataset.step === step);
    if (li.dataset.step === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
function working(text) { $('working-text').textContent = text; show('working'); }

// ---------- init ----------
async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const key = `capture:${id}`;
  const stored = id ? await chrome.storage.session.get(key) : {};
  state.capture = stored[key] || null;
  if (!state.capture) { show('missing'); return; }

  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  fillLanguageSelect();
  fillCategorySelect();
  fillFormatSelect();
  fillSource();

  const text = normalizeNewlines(state.capture.text);
  $('code').value = text;
  $('fallback-note').hidden = state.capture.method !== 'menu-fallback';
  const ctx = { languageHint: state.capture.languageHint, title: state.capture.title, url: state.capture.url };
  const cls = classify(text, ctx);
  $('language').value = cls.language;
  $('lang-confidence').textContent = cls.language === 'text' ? '' : `detected · ${cls.languageConfidence}`;
  if (state.capture.category && categoryById[state.capture.category]) {
    $('category').value = state.capture.category;
    $('cat-confidence').textContent = 'chosen';
  } else {
    $('category').value = cls.category;
    $('cat-confidence').textContent = `suggested · ${cls.confidence}`;
  }
  $('format').value = defaultFormat();
  $('add-header').checked = !!state.settings.addSourceHeader;
  $('url-mode').textContent = state.settings.fullSourceUrl ? '(full URL)' : '(URL without query string)';
  recordEntry(baseEntry({ status: 'captured' }));
  $('add-source-commit').checked = state.settings.includeSourceInCommit !== false;
  refreshSuggestions();
  rescanSecrets();
  updateStats();
  show('review');
  wireEvents();
  await connect(false);
}

function fillLanguageSelect() {
  const sel = $('language');
  for (const l of LANGUAGES) {
    const o = document.createElement('option');
    o.value = l.id;
    o.dataset.name = l.name;
    o.textContent = l.ext === 'Dockerfile' ? 'Dockerfile' : `${l.name} (.${l.ext})`;
    sel.append(o);
  }
}

function fillCategorySelect() {
  for (const c of CATEGORIES) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    o.title = c.description;
    $('category').append(o);
  }
}

function fillFormatSelect() {
  for (const f of FORMATS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name;
    $('format').append(o);
  }
}

function defaultFormat() {
  const cat = categoryById[$('category').value] || categoryById.code;
  // Source-file categories fall back to Markdown when no language was detected.
  if (cat.format === 'source' && $('language').value === 'text' && cat.id !== 'config') return 'md';
  return cat.format;
}

/** Folder template for the chosen category, with repository base folder applied. */
function folderFor(category, lang) {
  const cat = categoryById[category] || categoryById.code;
  const overrides = state.settings.categoryFolders || {};
  const template = category === 'code' ? (overrides.code ?? state.settings.folderTemplate) : (overrides[category] ?? cat.folder);
  const expanded = suggestFolder(expandCategoryTokens(template, $('code').value, state.capture), lang, state.capture);
  const base = ((state.settings.repoDefaults || {})[$('repo').value] || {}).baseFolder || '';
  return joinPath(base, expanded).replace(/\/$/, '');
}

function filenameFor() {
  const format = $('format').value;
  const lang = $('language').value;
  if (format === 'source') return suggestFilename($('code').value, lang, state.capture);
  return suggestTextFilename($('category').value, $('code').value, format, state.capture);
}

function fillFolderList() {
  const lang = $('language').value;
  const ideas = new Set([
    folderFor($('category').value, lang),
    ...CATEGORIES.map((c) => folderFor(c.id, lang)),
    platformFromUrl(state.capture.url),
    ...FOLDER_PRESETS,
  ].filter(Boolean));
  const list = $('folder-list');
  list.replaceChildren();
  for (const f of ideas) {
    const o = document.createElement('option');
    o.value = f;
    list.append(o);
  }
}

function fillSource() {
  const c = state.capture;
  let host = '';
  try { host = new URL(c.url).hostname; } catch { /* ignore */ }
  $('source-host').textContent = host ? `· ${host}` : '';
  $('source-title').textContent = c.title || '(no title)';
  $('source-url').textContent = c.url || '(unknown)';
  $('source-url').title = 'Recorded in the commit as: ' + (redactSourceUrl(c.url, { keepQuery: !!state.settings.fullSourceUrl }) || '(nothing)');
  $('source-time').textContent = new Date(c.capturedAt).toLocaleString();
}

// ---------- suggestions ----------
function refreshSuggestions() {
  const lang = $('language').value;
  if (!state.edited.format) $('format').value = defaultFormat();
  if (!state.edited.filename) $('filename').value = filenameFor();
  if (!state.edited.folder) $('folder').value = folderFor($('category').value, lang);
  if (!state.edited.commit) $('commit').value = suggestCommitMessage($('filename').value);
  if (!state.edited.tags) $('tags').value = suggestTags($('code').value, $('category').value, lang, state.capture).join(', ');
  $('add-header').disabled = $('format').value !== 'source';
  fillFolderList();
  updateDestination();
}

function currentPath() { return joinPath($('folder').value, $('filename').value.trim()); }

function updateDestination() {
  const repo = $('repo').value || '…';
  const branch = $('branch').value.trim() || '…';
  $('dest-preview').textContent = `${repo} @ ${branch} : ${currentPath()}`;
}

function updateStats() {
  const v = $('code').value;
  const lines = v ? v.split('\n').length : 0;
  $('code-stats').textContent = `${lines} line${lines === 1 ? '' : 's'} · ${new TextEncoder().encode(v).length.toLocaleString()} bytes`;
}

let scanTimer;
function rescanSecrets() {
  // Notes go into the commit message, so they are scanned too.
  const notes = $('notes').value;
  state.secrets = [
    ...scanForSecrets($('code').value),
    ...scanForSecrets(notes).map((f) => ({ ...f, type: `${f.type} in notes` })),
  ];
  const list = $('secret-list');
  list.replaceChildren();
  for (const f of state.secrets) {
    const li = document.createElement('li');
    li.textContent = `Line ${f.line}: ${f.type} (${f.preview})`;
    list.append(li);
  }
  $('secret-panel').hidden = state.secrets.length === 0;
}

// ---------- GitHub connection ----------
async function connect(forceRefresh) {
  const token = await getToken();
  if (!token) {
    state.client = null;
    $('connect-banner').hidden = false;
    $('account').textContent = '';
    setRepoOptions([], 'Not connected');
    return;
  }
  $('connect-banner').hidden = true;
  state.client = new GitHubClient(token);
  $('account').textContent = state.settings.githubLogin ? `@${state.settings.githubLogin}` : '';
  setRepoOptions([], 'Loading…');
  try {
    let repos = forceRefresh ? null : await getCachedRepos();
    if (!repos) {
      repos = await state.client.listRepos();
      await setCachedRepos(repos);
    }
    state.repos = repos;
    setRepoOptions(repos, repos.length ? '' : 'No repositories with write access');
    const pick = [state.settings.lastRepo, state.settings.defaultRepo].find((r) => r && repos.some((x) => x.fullName === r)) || (repos[0] && repos[0].fullName) || '';
    $('repo').value = pick;
    await loadBranches();
    if (!state.edited.folder) refreshSuggestions();
  } catch (err) {
    setRepoOptions([], 'Could not load repositories');
    if (err instanceof GitHubError && err.kind === 'auth') $('connect-banner').hidden = false;
    showFormErrors([err.message]);
  }
}

function setRepoOptions(repos, placeholder) {
  const sel = $('repo');
  sel.replaceChildren();
  if (placeholder) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    sel.append(o);
  }
  for (const r of repos) {
    const o = document.createElement('option');
    o.value = r.fullName;
    o.textContent = `${r.fullName}${r.private ? ' 🔒' : ''}`;
    sel.append(o);
  }
  sel.disabled = repos.length === 0;
  updateDestination();
}

async function loadBranches() {
  const full = $('repo').value;
  const repo = state.repos.find((r) => r.fullName === full);
  $('branch-list').replaceChildren();
  if (!repo) { updateDestination(); return; }
  const repoDefault = ((state.settings.repoDefaults || {})[full] || {}).branch;
  const preferred = (full === state.settings.lastRepo && state.settings.lastBranch)
    || repoDefault
    || (full === state.settings.defaultRepo && state.settings.defaultBranch)
    || repo.defaultBranch;
  $('branch').value = preferred;
  updateDestination();
  try {
    const names = await state.client.listBranches(full);
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n;
      $('branch-list').append(o);
    }
  } catch { /* the branch is re-checked before pushing */ }
}

// ---------- validation & confirm ----------
function showFormErrors(errors) {
  const ul = $('form-errors');
  ul.replaceChildren();
  for (const e of errors) {
    const li = document.createElement('li');
    li.textContent = e;
    ul.append(li);
  }
  ul.hidden = errors.length === 0;
}

function buildTarget() {
  const lang = $('language').value;
  const format = $('format').value;
  const code = normalizeNewlines($('code').value);
  const header = format === 'source' && $('add-header').checked ? sourceHeader(lang, state.capture, state.capture.capturedAt) : '';
  const subject = $('commit').value.trim() || suggestCommitMessage($('filename').value);
  const langName = lang === 'text' ? '' : (($('language').selectedOptions[0] || {}).dataset?.name || lang);
  const tags = parseTags($('tags').value);
  const category = $('category').value;
  const trailer = metadataTrailer(state.capture, state.capture.capturedAt, {
    includeSource: $('add-source-commit').checked,
    fullUrl: !!state.settings.fullSourceUrl,
    language: langName,
    category: (categoryById[category] || {}).name || '',
    tags,
    notes: $('notes').value,
  });
  const fence = lang === 'text' ? '' : lang;
  return {
    repo: $('repo').value,
    branch: $('branch').value.trim(),
    path: currentPath(),
    content: header + formatContent(code, format, fence),
    message: `${subject}\n\n${trailer}`,
    subject,
    category,
    language: lang,
    tags,
  };
}

/** Index entry fields that describe this capture. */
function baseEntry(extra = {}) {
  const c = state.capture;
  return {
    id: c.id,
    title: c.title ? String(c.title).slice(0, 200) : (String(c.text).trim().split('\n')[0] || '').slice(0, 120),
    sourceHost: hostOf(c.url),
    sourceUrl: redactSourceUrl(c.url, { keepQuery: !!state.settings.fullSourceUrl }),
    category: $('category').value,
    language: $('language').value,
    capturedAt: c.capturedAt,
    ...extra,
  };
}

async function recordTarget(status, extra = {}) {
  const t = state.target;
  await recordEntry(baseEntry({
    status,
    category: t.category,
    language: t.language,
    tags: t.tags,
    repo: t.repo,
    branch: t.branch,
    path: t.path,
    contentHash: state.contentHash,
    excerpt: makeExcerpt($('code').value, { enabled: state.settings.storeExcerpts !== false, hasSecrets: state.secrets.length > 0 }),
    ...extra,
  }));
}

function validateForm(t) {
  const errors = [];
  if (!state.client) errors.push('Connect to GitHub in Settings first.');
  if (!t.repo) errors.push('Choose a repository.');
  else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repo)) errors.push('The repository name is not valid.');
  errors.push(...validateBranch(t.branch));
  if (!$('filename').value.trim()) errors.push('Enter a filename.');
  errors.push(...validatePath(t.path));
  errors.push(...validateContent($('code').value));
  return errors;
}

async function goConfirm() {
  const t = buildTarget();
  const errors = validateForm(t);
  showFormErrors(errors);
  if (errors.length) return;
  state.target = t;
  state.contentHash = await sha256Hex(t.content);
  const dups = findDuplicates(await getIndex(), state.contentHash, state.capture.id).slice(0, 3);
  const dl = $('c-duplicate-list');
  dl.replaceChildren();
  for (const d of dups) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = `${d.repo}/${d.path}`;
    if (d.htmlUrl) { a.href = d.htmlUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    li.append(a, document.createTextNode(` · ${new Date(d.updatedAt).toLocaleDateString()}`));
    dl.append(li);
  }
  $('c-duplicate').hidden = dups.length === 0;
  $('c-message').textContent = t.message;
  $('c-repo').textContent = t.repo;
  $('c-branch').textContent = t.branch;
  $('c-path').textContent = t.path;
  $('c-commit').textContent = t.subject;
  const lines = t.content.split('\n').length;
  $('c-size').textContent = `${lines} lines · ${new TextEncoder().encode(t.content).length.toLocaleString()} bytes`;
  $('c-preview').textContent = t.content;
  rescanSecrets();
  $('c-secrets').hidden = state.secrets.length === 0;
  $('c-secret-count').textContent = `${state.secrets.length} possible secret${state.secrets.length === 1 ? '' : 's'} found (see the list on the previous screen).`;
  $('c-secret-ack').checked = false;
  syncPushEnabled();
  show('confirm');
}

function syncPushEnabled() {
  $('do-push').disabled = state.secrets.length > 0 && !$('c-secret-ack').checked;
}

// ---------- push ----------
async function attemptPush(raceRetries = 1) {
  const t = state.target;
  const gh = state.client;
  try {
    await recordTarget('pending');
    working('Checking branch…');
    if (!(await gh.branchExists(t.repo, t.branch))) {
      throw new GitHubError('not_found', `Branch "${t.branch}" does not exist in ${t.repo}. Pick an existing branch.`);
    }
    working('Checking whether the file already exists…');
    const existing = await gh.getFile(t.repo, t.path, t.branch);
    if (existing && !existing.isFile) { $('nf-path').textContent = t.path; show('notfile'); return; }
    if (existing) {
      if (existing.content !== null && existing.content === t.content) {
        // Same content already there (e.g. a retry after a dropped connection). Nothing to commit.
        await done({ htmlUrl: existing.htmlUrl }, 'This exact file is already on GitHub', 'duplicate');
        return;
      }
      state.existing = existing;
      await recordTarget('conflict');
      showConflict(existing);
      return;
    }
    working('Saving to GitHub…');
    try {
      const res = await gh.putFile(t.repo, t.path, { content: t.content, message: t.message, branch: t.branch });
      await done(res, 'Saved to GitHub', 'uploaded');
    } catch (err) {
      // Someone created the file between our check and the write: re-check instead of overwriting.
      if (err instanceof GitHubError && err.kind === 'conflict' && raceRetries > 0) { await attemptPush(raceRetries - 1); return; }
      throw err;
    }
  } catch (err) {
    showError(err);
  }
}

function showConflict(existing) {
  const t = state.target;
  $('x-path').textContent = t.path;
  $('x-branch').textContent = t.branch;
  $('x-existing').textContent = existing.content ?? '(The existing file is too large or binary to preview.)';
  $('x-new').textContent = t.content;
  if (existing.content !== null) renderDiff($('x-diff'), existing.content, t.content);
  else $('x-diff').textContent = 'The existing file is too large or binary to compare.';
  $('x-update-confirm-row').hidden = true;
  $('x-update-confirm').checked = false;
  $('x-update').textContent = 'Replace the existing file…';
  show('conflict');
}

async function saveAsAnother() {
  const t = state.target;
  try {
    working('Finding a free filename…');
    for (let n = 2; n <= 50; n++) {
      const candidate = nextAvailableName(t.path, n);
      if (!(await state.client.getFile(t.repo, candidate, t.branch))) {
        const slash = candidate.lastIndexOf('/');
        $('filename').value = candidate.slice(slash + 1);
        state.edited.filename = true;
        $('folder').value = slash >= 0 ? candidate.slice(0, slash) : '';
        state.edited.folder = true;
        updateDestination();
        goConfirm(); // user confirms the new name explicitly
        return;
      }
    }
    throw new GitHubError('invalid', 'Could not find a free filename. Rename the file manually.');
  } catch (err) { showError(err); }
}

async function updateExisting() {
  if ($('x-update-confirm-row').hidden) {
    // First click reveals an explicit confirmation; never overwrite on a single click.
    $('x-update-confirm-row').hidden = false;
    $('x-update').textContent = 'Replace now';
    return;
  }
  if (!$('x-update-confirm').checked) { $('x-update-confirm').focus(); return; }
  const t = state.target;
  const updateSubject = t.subject.replace(/^Add\b/, 'Update');
  const message = t.message.replace(t.subject, updateSubject);
  try {
    working('Updating the file on GitHub…');
    const res = await state.client.putFile(t.repo, t.path, { content: t.content, message, branch: t.branch, sha: state.existing.sha });
    await done(res, 'Updated on GitHub', 'updated');
  } catch (err) { showError(err); }
}

async function done(res, title, status) {
  const t = state.target;
  $('s-title').textContent = title;
  $('s-repo').textContent = t.repo;
  $('s-branch').textContent = t.branch;
  $('s-path').textContent = t.path;
  const fallback = `https://github.com/${t.repo}/blob/${encodeURIComponent(t.branch)}/${t.path.split('/').map(encodeURIComponent).join('/')}`;
  // Only ever link to github.com, even if an API response were tampered with.
  const url = typeof res.htmlUrl === 'string' && /^https:\/\/github\.com\//.test(res.htmlUrl) ? res.htmlUrl : fallback;
  $('s-link').href = url;
  show('success');
  state.settings = await saveSettings({ lastRepo: t.repo, lastBranch: t.branch });
  await recordTarget(status, { htmlUrl: url, commitSha: res.commitSha || '', commitUrl: res.commitUrl || '', error: '' });
  await chrome.storage.session.remove(`capture:${state.capture.id}`);
}

function showError(err) {
  const e = err instanceof GitHubError ? err : new GitHubError('unexpected', 'Something unexpected went wrong in the extension. Your content is still here; go back and try again.', { detail: String(err && err.message).slice(0, 300) });
  if (state.target) recordTarget('failed', { error: e.message.slice(0, 200) });
  $('e-message').textContent = e.message;
  $('e-detail').textContent = e.detail || `(${e.kind}${e.status ? `, HTTP ${e.status}` : ''})`;
  $('e-retry').hidden = !(e.retryable || e.kind === 'conflict');
  $('e-settings').hidden = e.kind !== 'auth';
  show('error');
}

// ---------- events ----------
function wireEvents() {
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'cancel') window.close();
    if (a.dataset.action === 'back') show('review');
  });
  $('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('e-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('refresh-repos').addEventListener('click', async () => { state.settings = await getSettings(); await connect(true); });
  $('repo').addEventListener('change', async () => { await loadBranches(); if (!state.edited.folder) refreshSuggestions(); });
  $('branch').addEventListener('input', updateDestination);

  $('language').addEventListener('change', () => { $('lang-confidence').textContent = ''; refreshSuggestions(); });
  $('category').addEventListener('change', () => { $('cat-confidence').textContent = ''; state.edited.format = false; refreshSuggestions(); });
  $('format').addEventListener('change', () => { state.edited.format = true; refreshSuggestions(); });
  $('tags').addEventListener('input', () => { state.edited.tags = true; });
  $('notes').addEventListener('input', () => { clearTimeout(scanTimer); scanTimer = setTimeout(rescanSecrets, 250); });
  $('filename').addEventListener('input', () => {
    state.edited.filename = true;
    const fromExt = languageFromExtension($('filename').value);
    if ($('format').value === 'source' && fromExt && fromExt !== $('language').value) { $('language').value = fromExt; $('lang-confidence').textContent = 'from extension'; }
    if (!state.edited.commit) $('commit').value = suggestCommitMessage($('filename').value);
    updateDestination();
  });
  $('filename').addEventListener('blur', () => {
    const clean = sanitizeFilename($('filename').value.trim());
    if (clean && clean !== $('filename').value) { $('filename').value = clean; updateDestination(); }
  });
  $('folder').addEventListener('input', () => { state.edited.folder = true; updateDestination(); });
  $('commit').addEventListener('input', () => { state.edited.commit = true; });
  $('code').addEventListener('input', () => {
    updateStats();
    clearTimeout(scanTimer);
    scanTimer = setTimeout(rescanSecrets, 250);
  });
  // Tab inserts a tab character in the editor; press Esc first to move focus out with Tab.
  let escaped = false;
  $('code').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { escaped = true; return; }
    if (ev.key === 'Tab' && !ev.shiftKey && !escaped) {
      ev.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
    if (ev.key !== 'Tab') escaped = false;
  });

  $('to-confirm').addEventListener('click', goConfirm);
  $('c-secret-ack').addEventListener('change', syncPushEnabled);
  $('do-push').addEventListener('click', () => { if (!$('do-push').disabled) attemptPush(); });
  // Ctrl/Cmd+Enter: go to confirm from the editor screen.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !$('screen-review').hidden) { ev.preventDefault(); goConfirm(); }
  });
  $('x-rename').addEventListener('click', saveAsAnother);
  $('x-update').addEventListener('click', updateExisting);
  $('e-retry').addEventListener('click', () => attemptPush());
}

init();
