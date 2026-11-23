// Background service worker: context menu, keyboard shortcut and popup capture requests.
// No GitHub calls happen here; the token is never read by the worker.

import { readSelectionFromTab, buildCapture, storeCapture } from '../capture/capture.js';

const MENU_ID = 'gcp-capture-selection';
const COMMAND_ID = 'capture-selection';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Capture code with Git Code Port',
      contexts: ['selection'],
    });
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

const NO_SELECTION = 'No code selected. Highlight the code on the page first, then try again.';
const RESTRICTED = 'This page does not allow extensions to read it (for example chrome:// pages, the Chrome Web Store or the built-in PDF viewer). Copy the code into a normal web page or use the menu on the selection instead.';

async function openReview(captureId) {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`src/review/review.html?id=${encodeURIComponent(captureId)}`),
    type: 'popup',
    width: 860,
    height: 920,
  });
}

/** Briefly flags the toolbar icon when a shortcut capture finds nothing (no notifications permission needed). */
async function flagIcon(tabId, message) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#cf222e', tabId });
    await chrome.action.setBadgeText({ text: '!', tabId });
    await chrome.action.setTitle({ title: `Git Code Port: ${message}`, tabId });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
      chrome.action.setTitle({ title: 'Git Code Port', tabId }).catch(() => {});
    }, 6000);
  } catch (_) { /* tab may be gone */ }
}

/**
 * Shared capture path for the menu, the shortcut and the popup.
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function captureAndReview(tab, hints = {}) {
  const read = await readSelectionFromTab(tab, hints);
  if (!read.text.trim()) return { ok: false, error: read.restricted ? RESTRICTED : NO_SELECTION };
  const capture = buildCapture(read, tab, hints);
  await storeCapture(capture);
  await openReview(capture.id);
  return { ok: true, id: capture.id };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  captureAndReview(tab, { frameId: info.frameId, selectionText: info.selectionText, pageUrl: info.pageUrl, frameUrl: info.frameUrl })
    .then((r) => { if (!r.ok && tab) flagIcon(tab.id, r.error); })
    .catch(() => { if (tab) flagIcon(tab.id, 'Something went wrong while capturing.'); });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== COMMAND_ID || !tab) return;
  captureAndReview(tab)
    .then((r) => { if (!r.ok) flagIcon(tab.id, r.error); })
    .catch(() => flagIcon(tab.id, 'Something went wrong while capturing.'));
});

// Only this extension's own pages (the popup) may ask for a capture. Content scripts are not
// used, and web pages cannot reach this listener because there is no externally_connectable.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fromOwnPage = sender.id === chrome.runtime.id
    && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (!fromOwnPage || !msg || msg.type !== 'capture-active-tab') return false;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return { ok: false, error: 'No active tab found.' };
    return captureAndReview(tab);
  })()
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'Something went wrong while capturing.' }));
  return true; // async response
});

// Exposed for automated tests only: a real menu click cannot be simulated headlessly.
// It lives on the worker's own global, which web pages cannot reach.
globalThis.__gcpCapture = captureAndReview;
