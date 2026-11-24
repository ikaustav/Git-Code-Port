// Renders recent index entries with DOM APIs only (paths and URLs are data, never HTML).
import { STATUS, CONFIRMED } from '../history/index.js';

export function renderHistory(ul, entries, limit = 20, { confirmedOnly = true } = {}) {
  ul.replaceChildren();
  const items = entries.filter((e) => !confirmedOnly || CONFIRMED.has(e.status)).slice(0, limit);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nothing saved yet.';
    ul.append(li);
    return;
  }
  for (const h of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = /^https:\/\/github\.com\//.test(h.htmlUrl || '') ? h.htmlUrl : '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${h.repo}/${h.path}`;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = [new Date(h.updatedAt).toLocaleString(), h.sourceHost ? `from ${h.sourceHost}` : '', STATUS[h.status] || ''].filter(Boolean).join(' · ');
    li.append(a, meta);
    ul.append(li);
  }
}
