// Reads the user's selection from a tab and stores it as a short-lived capture.
// Captured text is untrusted page content: it is stored as a plain string and only ever shown
// through form values or textContent. It is never rendered as HTML and never executed.

export const CAPTURE_PREFIX = 'capture:';
const CAPTURE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CAPTURE_CHARS = 2 * 1024 * 1024;

/**
 * Runs inside the page (isolated world) via chrome.scripting. It must be self-contained:
 * no closures over extension scope. It reads text only.
 */
export function readSelectionInPage() {
  const active = document.activeElement;
  let text = '';
  let fromField = false;
  if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && /^(text|search|url)$/i.test(active.type)))) {
    const { selectionStart: s, selectionEnd: e } = active;
    if (typeof s === 'number' && e > s) { text = active.value.slice(s, e); fromField = true; }
  }
  const sel = window.getSelection();
  if (!text && sel) text = sel.toString();

  // Language hint near the selection: class="language-python", data-lang="js", etc.
  let languageHint = '';
  try {
    let node = fromField ? active : sel && sel.anchorNode;
    if (node && node.nodeType !== 1) node = node.parentElement;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const cls = typeof node.className === 'string' ? node.className : '';
      const m = cls.match(/(?:^|\s)(?:language|lang|highlight-source|brush:?)-?([\w+#-]+)/i);
      const data = node.getAttribute && (node.getAttribute('data-language') || node.getAttribute('data-lang') || node.getAttribute('data-mode-id'));
      if (data) { languageHint = data; break; }
      if (m) { languageHint = m[1]; break; }
    }
  } catch (_) { /* ignore */ }

  return { text, languageHint: String(languageHint).slice(0, 40) };
}

/** Pages where Chrome never lets extensions run scripts. */
export function isRestrictedUrl(url) {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url || '')
    || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)\//i.test(url || '');
}

/**
 * @param {chrome.tabs.Tab} tab
 * @param {{ frameId?: number, selectionText?: string }} hints  From the context menu, when available.
 * @returns {Promise<{ text: string, languageHint: string, method: 'selection'|'menu-fallback'|'none', restricted: boolean }>}
 */
export async function readSelectionFromTab(tab, hints = {}) {
  let restricted = !tab || tab.id < 0 || isRestrictedUrl(tab.url);
  if (!restricted) {
    try {
      const target = typeof hints.frameId === 'number'
        ? { tabId: tab.id, frameIds: [hints.frameId] }
        : { tabId: tab.id, allFrames: true };
      let results;
      try {
        results = await chrome.scripting.executeScript({ target, func: readSelectionInPage });
      } catch (err) {
        // A frame we may not access can fail the whole call; retry the top frame alone.
        if (!target.allFrames) throw err;
        results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSelectionInPage });
      }
      // Prefer the top frame, then the first frame that has a selection.
      const sorted = (results || []).slice().sort((a, b) => (a.frameId || 0) - (b.frameId || 0));
      const hit = sorted.map((r) => r && r.result).find((r) => r && typeof r.text === 'string' && r.text.trim());
      if (hit) return { text: hit.text.slice(0, MAX_CAPTURE_CHARS), languageHint: hit.languageHint || '', method: 'selection', restricted: false };
    } catch (_) {
      // PDF viewer, cross-origin frame without access, or a page that blocks extensions.
      restricted = true;
    }
  }
  // info.selectionText collapses newlines and indentation, so it is only a fallback.
  const fallback = String(hints.selectionText || '');
  if (fallback.trim()) return { text: fallback.slice(0, MAX_CAPTURE_CHARS), languageHint: '', method: 'menu-fallback', restricted };
  return { text: '', languageHint: '', method: 'none', restricted };
}

export function buildCapture(read, tab, hints = {}) {
  return {
    id: crypto.randomUUID(),
    text: read.text,
    languageHint: read.languageHint,
    method: read.method,
    url: hints.frameUrl || hints.pageUrl || (tab && tab.url) || '',
    pageUrl: hints.pageUrl || (tab && tab.url) || '',
    title: (tab && tab.title) || '',
    capturedAt: new Date().toISOString(),
    createdAt: Date.now(),
  };
}

export async function purgeOldCaptures(now = Date.now()) {
  const all = await chrome.storage.session.get(null);
  const stale = Object.entries(all)
    .filter(([k, v]) => k.startsWith(CAPTURE_PREFIX) && (!v || now - (v.createdAt || 0) > CAPTURE_TTL_MS))
    .map(([k]) => k);
  if (stale.length) await chrome.storage.session.remove(stale);
}

export async function storeCapture(capture) {
  await purgeOldCaptures();
  await chrome.storage.session.set({ [CAPTURE_PREFIX + capture.id]: capture });
}
