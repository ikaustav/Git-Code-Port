// Renders recent saves with DOM APIs only (paths and URLs are data, never HTML).
export function renderHistory(ul, items, limit = 20) {
  ul.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nothing saved yet.';
    ul.append(li);
    return;
  }
  for (const h of items.slice(0, limit)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = /^https:\/\/github\.com\//.test(h.url) ? h.url : '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${h.repo}/${h.path}`;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    let host = '';
    try { host = h.sourceUrl ? new URL(h.sourceUrl).hostname : ''; } catch { /* ignore */ }
    meta.textContent = `${new Date(h.savedAt).toLocaleString()}${host ? ` · from ${host}` : ''}`;
    li.append(a, meta);
    ul.append(li);
  }
}
