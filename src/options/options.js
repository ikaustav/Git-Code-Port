import { GitHubClient, GitHubError } from '../github/api.js';
import { getSettings, saveSettings, getToken, setToken, clearToken } from '../storage/settings.js';
import { getIndex, clearIndex } from '../history/index.js';
import { isPlausibleToken } from '../security/token.js';
import { applyTheme } from '../ui/theme.js';
import { renderHistory } from '../ui/history.js';
import { validateBranch } from '../utils/validation.js';

const $ = (id) => document.getElementById(id);

async function renderConnection() {
  const token = await getToken();
  const settings = await getSettings();
  $('connected').hidden = !token;
  $('connect-form').hidden = !!token;
  if (token) {
    $('login').textContent = settings.githubLogin ? `@${settings.githubLogin}` : '(unknown account)';
    const { githubToken } = await chrome.storage.local.get('githubToken');
    $('token-where').textContent = githubToken ? '· remembered on this device' : '· until the browser closes';
  }
  $('remember').checked = !!settings.rememberToken;
}

async function renderDefaults() {
  const s = await getSettings();
  $('default-repo').value = s.defaultRepo;
  $('default-branch').value = s.defaultBranch;
  $('folder-template').value = s.folderTemplate;
  $('add-header').checked = s.addSourceHeader;
  $('source-commit').checked = s.includeSourceInCommit !== false;
}

$('connect-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $('token').value.trim();
  const err = $('connect-error');
  err.hidden = true;
  if (!isPlausibleToken(token)) {
    err.textContent = 'That does not look like a GitHub token (expected github_pat_… or ghp_…).';
    err.hidden = false;
    return;
  }
  $('connect-btn').disabled = true;
  $('connect-btn').textContent = 'Checking…';
  try {
    const user = await new GitHubClient(token).getUser();
    const remember = $('remember').checked;
    await setToken(token, remember);
    await saveSettings({ githubLogin: user.login, rememberToken: remember });
    await chrome.storage.local.remove('repoCache');
    $('token').value = '';
    await renderConnection();
  } catch (e) {
    err.textContent = e instanceof GitHubError ? e.message : 'Could not verify the token.';
    err.hidden = false;
  } finally {
    $('connect-btn').disabled = false;
    $('connect-btn').textContent = 'Connect';
  }
});

$('disconnect').addEventListener('click', async () => {
  await clearToken();
  await renderConnection();
});

/** Accepts "owner/name", "https://github.com/owner/name(.git)" or empty. */
function normalizeRepo(value) {
  return value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
}

$('defaults-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const repo = normalizeRepo($('default-repo').value);
  const branch = $('default-branch').value.trim();
  const problems = [];
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) problems.push('Default repository must look like owner/name.');
  if (branch) problems.push(...validateBranch(branch));
  const folder = $('folder-template').value.trim();
  if (/(^|\/)\.\.?(\/|$)|\\/.test(folder)) problems.push('Folder template must not contain "..", "." or "\\".');
  $('defaults-error').textContent = problems.join(' ');
  $('defaults-error').hidden = problems.length === 0;
  if (problems.length) return;
  await saveSettings({
    defaultRepo: normalizeRepo($('default-repo').value),
    defaultBranch: $('default-branch').value.trim(),
    folderTemplate: $('folder-template').value.trim(),
    addSourceHeader: $('add-header').checked,
    includeSourceInCommit: $('source-commit').checked,
  });
  $('saved').hidden = false;
  setTimeout(() => { $('saved').hidden = true; }, 1500);
});

$('clear-history').addEventListener('click', async () => {
  await clearIndex();
  renderHistory($('history'), []);
});

renderConnection();
renderDefaults();
getIndex().then((h) => renderHistory($('history'), h));
getSettings().then((s) => applyTheme(s.theme));
