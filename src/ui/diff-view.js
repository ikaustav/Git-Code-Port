// Renders a diff into a container using DOM APIs only (content is untrusted text).
import { diffLines, withContext } from '../history/diff.js';

const PREFIX = { same: '  ', add: '+ ', del: '- ', skip: '' };

export function renderDiff(container, oldText, newText) {
  container.replaceChildren();
  const d = diffLines(oldText, newText);
  const summary = document.createElement('p');
  summary.className = 'diff-summary small';
  if (d.tooLarge) {
    summary.textContent = `Too large to compare line by line here (${d.removed} lines removed, ${d.added} lines added at most).`;
    container.append(summary);
    return d;
  }
  summary.textContent = d.added || d.removed ? `${d.added} line${d.added === 1 ? '' : 's'} added, ${d.removed} removed` : 'No differences.';
  const pre = document.createElement('pre');
  pre.className = 'code-preview diff';
  // Inner wrapper as wide as the longest line, so line backgrounds span the full scroll width.
  const lines = document.createElement('div');
  lines.className = 'diff-lines';
  for (const op of withContext(d.ops)) {
    const line = document.createElement('span');
    line.className = `diff-${op.type}`;
    line.textContent = `${PREFIX[op.type]}${op.text}\n`;
    lines.append(line);
  }
  pre.append(lines);
  container.append(summary, pre);
  return d;
}
