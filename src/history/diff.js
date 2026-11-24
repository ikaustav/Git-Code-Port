// Small line-based diff (LCS) for comparing an existing GitHub file with new content.
// Pure function, no DOM. Large inputs fall back to a summary instead of freezing the UI.

export const MAX_DIFF_CELLS = 4_000_000; // lines(a) * lines(b)

/**
 * @returns {{ ops: Array<{ type: 'same'|'add'|'del', text: string }>, added: number, removed: number, tooLarge: boolean }}
 */
export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');
  // Trim common prefix and suffix first: most edits are local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  const head = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail = a.slice(endA + 1).map((text) => ({ type: 'same', text }));

  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    return { ops: [], added: midB.length, removed: midA.length, tooLarge: true };
  }
  const n = midA.length;
  const m = midB.length;
  // LCS table with typed rows to keep memory predictable.
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const mid = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { mid.push({ type: 'same', text: midA[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { mid.push({ type: 'del', text: midA[i++] }); }
    else { mid.push({ type: 'add', text: midB[j++] }); }
  }
  while (i < n) mid.push({ type: 'del', text: midA[i++] });
  while (j < m) mid.push({ type: 'add', text: midB[j++] });
  const ops = [...head, ...mid, ...tail];
  return {
    ops,
    added: ops.filter((o) => o.type === 'add').length,
    removed: ops.filter((o) => o.type === 'del').length,
    tooLarge: false,
  };
}

/** Collapses long unchanged runs, keeping `context` lines around each change. */
export function withContext(ops, context = 3) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ type: 'skip', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'} …` }); skipped = 0; }
      out.push(o);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'skip', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'} …` });
  return out;
}
