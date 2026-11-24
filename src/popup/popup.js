import { getSettings, getToken } from '../storage/settings.js';
import { getIndex } from '../history/index.js';
import { renderHistory } from '../ui/history.js';
import { applyTheme } from '../ui/theme.js';

const $ = (id) => document.getElementById(id);

function showError(message) {
  $('capture-error').textContent = message;
  $('capture-error').hidden = false;
}

(async () => {
  const [token, settings, history] = await Promise.all([getToken(), getSettings(), getIndex()]);
  applyTheme(settings.theme);
  $('status').textContent = token
    ? `Connected to GitHub${settings.githubLogin ? ` as @${settings.githubLogin}` : ''}`
    : 'Not connected. Open Settings to add a token.';
  $('status-dot').className = `dot ${token ? 'on' : 'off'}`;
  renderHistory($('history'), history, 5);
  try {
    const cmds = await chrome.commands.getAll();
    const cmd = cmds.find((c) => c.name === 'capture-selection');
    if (cmd && cmd.shortcut) $('shortcut').textContent = cmd.shortcut;
    else $('shortcut-hint').hidden = true; // shortcut taken by another extension, or removed
  } catch { /* keep default text */ }
})();

$('capture').addEventListener('click', async () => {
  $('capture-error').hidden = true;
  $('capture').disabled = true;
  $('capture').textContent = 'Capturing…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'capture-active-tab' });
    if (res && res.ok) { window.close(); return; }
    showError((res && res.error) || 'Could not capture the selection.');
  } catch {
    showError('Could not capture the selection. Reload the page and try again.');
  } finally {
    $('capture').disabled = false;
    $('capture').textContent = 'Capture selection';
  }
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

// sidePanel.open must be called synchronously inside the click (user gesture),
// so the window id is looked up in advance.
let windowId = null;
chrome.windows.getCurrent().then((w) => { windowId = w.id; }).catch(() => {});

$('workspace').addEventListener('click', () => {
  if (windowId === null || !chrome.sidePanel) { showError('Could not open the side panel. Update Chrome to version 116 or newer.'); return; }
  chrome.sidePanel.open({ windowId }).then(() => window.close()).catch(() => {
    showError('Could not open the side panel. Update Chrome to version 116 or newer.');
  });
});
