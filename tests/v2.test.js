import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage } from '../src/security/messages.js';
import { redactSourceUrl, hostOf } from '../src/security/redact.js';
import { assessToken, isPlausibleToken } from '../src/security/token.js';
import { classify, suggestTags, suggestTextFilename, expandCategoryTokens, commandTool, parseTags } from '../src/classifier/classify.js';
import { formatContent, CATEGORIES } from '../src/classifier/categories.js';
import { upsert, search, findDuplicates, migrateLegacy, makeExcerpt, sha256Hex, CONFIRMED } from '../src/history/index.js';
import { diffLines, withContext } from '../src/history/diff.js';
import { GitHubClient, isSha, safeGitHubUrl } from '../src/github/api.js';
import { scanForSecrets } from '../src/processing/secret-scan.js';

const SELF = { id: 'abc', baseUrl: 'chrome-extension://abc/' };
const POPUP = { id: 'abc', url: 'chrome-extension://abc/src/popup/popup.html', origin: 'chrome-extension://abc' };

test('message validation: sender, type allow-list and payload shape', () => {
  assert.equal(validateMessage({ type: 'capture-active-tab' }, POPUP, SELF).ok, true);
  assert.equal(validateMessage({ type: 'capture-active-tab', category: 'notes' }, POPUP, SELF).ok, true);
  const bad = [
    [{ type: 'capture-active-tab' }, { ...POPUP, id: 'other-extension' }],
    [{ type: 'capture-active-tab' }, { id: 'abc', url: 'https://evil.example/', origin: 'https://evil.example' }],
    [{ type: 'capture-active-tab' }, { id: 'abc', url: 'chrome-extension://abc/x.html', origin: 'https://evil.example' }],
    [{ type: 'capture-active-tab' }, undefined],
    [{ type: 'push-file', path: 'a' }, POPUP],
    [{ type: 'capture-active-tab', category: 'evil' }, POPUP],
    [{ type: 'capture-active-tab', category: { toString: () => 'notes' } }, POPUP],
    [{ type: 'capture-active-tab', tabId: 3 }, POPUP],
    [{ type: '__proto__' }, POPUP],
    [{ type: 'constructor' }, POPUP],
    ['capture-active-tab', POPUP],
    [null, POPUP],
    [['capture-active-tab'], POPUP],
  ];
  for (const [msg, sender] of bad) assert.equal(validateMessage(msg, sender, SELF).ok, false, JSON.stringify(msg));
});

test('source URLs are redacted to origin + path by default', () => {
  assert.equal(redactSourceUrl('https://user:pw@site.com/a/b?token=SECRET#x'), 'https://site.com/a/b');
  assert.equal(redactSourceUrl('https://site.com/a?x=1#h', { keepQuery: true }), 'https://site.com/a?x=1#h');
  assert.equal(redactSourceUrl('https://u:p@site.com/a?x=1', { keepQuery: true }), 'https://site.com/a?x=1');
  assert.equal(redactSourceUrl('file:///home/me/secret.txt'), 'file:…');
  assert.equal(redactSourceUrl('javascript:alert(1)'), 'javascript:…');
  assert.equal(redactSourceUrl('not a url'), '');
  assert.equal(hostOf('https://www.leetcode.com/x'), 'leetcode.com');
});

test('token assessment never needs the token value beyond its prefix', () => {
  const now = new Date('2026-11-24T00:00:00Z');
  const fg = assessToken(`github_pat_${'a'.repeat(30)}`, { expiration: '2026-11-27 10:00:00 UTC' }, now);
  assert.equal(fg.kind, 'fine-grained');
  assert.equal(fg.expiresAt, '2026-11-27T10:00:00.000Z');
  assert.match(fg.warnings.join(' '), /expires in 4 day/);
  const classic = assessToken(`ghp_${'a'.repeat(36)}`, { scopes: 'repo, workflow' }, now);
  assert.equal(classic.kind, 'classic');
  assert.match(classic.warnings.join(' '), /classic token/);
  assert.match(classic.warnings.join(' '), /"repo" scope/);
  assert.match(classic.warnings.join(' '), /no expiration/);
  assert.match(assessToken(`github_pat_${'a'.repeat(30)}`, { expiration: '2026-01-01 00:00:00 UTC' }, now).warnings.join(' '), /expired/);
  assert.equal(isPlausibleToken('github_pat_short'), false);
  assert.equal(isPlausibleToken(`github_pat_${'A1_'.repeat(10)}`), true);
  assert.equal(isPlausibleToken(`github_pat_${'a'.repeat(30)}\nX-Evil: 1`), false);
});

test('classification covers code, DSA, commands, SQL, config, notes, docs, research, prompts and resources', () => {
  const cases = [
    ['code', 'def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n', {}],
    ['code', 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}', {}],
    ['dsa', 'class Solution {\npublic:\n    int twoSum(vector<int>& nums) { return 0; }\n};', { url: 'https://leetcode.com/problems/two-sum/' }],
    ['dsa', 'def solve():\n    n = int(input())\n    print(n * 2)\n\nfor _ in range(int(input())):\n    solve()\n', {}],
    ['commands', 'git checkout -b feature\ngit add .\ngit commit -m "x"', {}],
    ['commands', '$ sudo apt update\n$ sudo apt install nginx', {}],
    ['sql', 'SELECT name FROM users WHERE id = 1;', {}],
    ['config', '{"name": "x", "version": "1.0.0"}', {}],
    ['config', 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n', {}],
    ['config', '[server]\nport=8080\nhost=localhost', {}],
    ['notes', '- Arrays are contiguous\n- Linked lists use pointers', {}],
    ['notes', '# Big-O\nO(1) is constant time.', {}],
    ['docs', 'The map() method creates a new array populated with the results of calling a provided function on every element.', { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map' }],
    ['research', 'Attention is all you need (Vaswani et al., 2017). This paper proposes the Transformer. doi:10.48550/arXiv.1706.03762', {}],
    ['prompt', 'You are a senior reviewer. Review this pull request and list risky changes, then suggest tests.', {}],
    ['resource', 'Good habits compound over time, which is why small daily improvements matter more than occasional big efforts.', {}],
  ];
  for (const [want, text, ctx] of cases) assert.equal(classify(text, ctx).category, want, text.slice(0, 40));
  assert.equal(classify('', {}).category, 'notes');
});

test('spec example filenames and folders', () => {
  assert.equal(suggestTextFilename('commands', 'ls -la\ncd /tmp\nmkdir x', 'md-code'), 'linux-commands.md');
  assert.equal(suggestTextFilename('commands', 'git status\ngit pull', 'md-code'), 'git-commands.md');
  assert.equal(suggestTextFilename('notes', 'x', 'md'), 'notes.md');
  assert.equal(suggestTextFilename('research', 'x', 'md'), 'research.md');
  assert.match(suggestTextFilename('prompt', 'You are a helpful tutor.', 'md'), /^prompt-you-are-a-helpful-tutor\.md$/);
  assert.equal(suggestTextFilename('notes', 'x', 'md', { title: 'Big O Cheat Sheet - Blog' }), 'big-o-cheat-sheet.md');
  assert.equal(suggestTextFilename('notes', 'x', 'txt'), 'notes.txt');
  assert.equal(expandCategoryTokens('Coding/{platform:DSA}', '', { url: 'https://codeforces.com/x' }), 'Coding/Codeforces');
  assert.equal(expandCategoryTokens('Coding/{platform:DSA}', '', { url: 'https://example.com' }), 'Coding/DSA');
  assert.equal(expandCategoryTokens('Developer-Tools/{tool}', 'docker ps\ndocker run x'), 'Developer-Tools/Docker');
  assert.equal(commandTool('kubectl get pods'), 'Kubernetes');
  assert.ok(CATEGORIES.every((c) => c.folder && c.base && c.format));
});

test('tags are suggested and parsed safely', () => {
  assert.deepEqual(suggestTags('def f(n): return f(n-1) # recursion', 'dsa', 'python', { url: 'https://leetcode.com/p' }), ['python', 'leetcode', 'dsa', 'recursion']);
  assert.deepEqual(parseTags('Python, #DSA  graphs,,graphs <script>'), ['python', 'dsa', 'graphs', '-script-']);
  assert.ok(parseTags(Array(30).fill('t').map((t, i) => t + i).join(',')).length <= 12);
});

test('formats keep content exactly, except md-code fences which are collision-safe', () => {
  const text = 'a\n\tb ✓\n';
  for (const f of ['source', 'md', 'txt']) assert.equal(formatContent(text, f), text);
  assert.equal(formatContent('ls\n', 'md-code', 'bash'), '```bash\nls\n```\n');
  const tricky = 'echo "```"\n````\n';
  const out = formatContent(tricky, 'md-code');
  assert.ok(out.startsWith('`````\n') && out.endsWith('\n`````\n'), out);
});

test('index: upsert keeps one entry per id, search, duplicates, migration, excerpts', async () => {
  let entries = [];
  entries = upsert(entries, { id: 'a', status: 'captured', title: 'Two Sum', category: 'dsa', tags: ['python'], updatedAt: '2026-01-01' });
  entries = upsert(entries, { id: 'b', status: 'uploaded', title: 'Notes', category: 'notes', repo: 'o/r', path: 'Learning/n.md', contentHash: 'h1', updatedAt: '2026-01-02' });
  entries = upsert(entries, { id: 'a', status: 'uploaded', repo: 'o/r', path: 'Coding/two_sum.py', contentHash: 'h1', updatedAt: '2026-01-03' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'a');
  assert.equal(entries[0].title, 'Two Sum', 'fields are merged');
  assert.equal(search(entries, { q: 'two python' }).length, 1);
  assert.equal(search(entries, { q: 'learning/n' }).length, 1);
  assert.equal(search(entries, { category: 'notes' })[0].id, 'b');
  assert.equal(search(entries, { status: 'local' }).length, 0);
  assert.deepEqual(findDuplicates(entries, 'h1', 'a').map((e) => e.id), ['b']);
  assert.equal(findDuplicates(entries, '', 'x').length, 0);
  const many = Array.from({ length: 510 }, (_, i) => ({ id: String(i), updatedAt: String(i).padStart(4, '0') }));
  assert.equal(many.reduce((acc, e) => upsert(acc, e), []).length, 500);
  const legacy = migrateLegacy([{ repo: 'o/r', path: 'P/a.py', url: 'https://github.com/o/r/blob/main/P/a.py', sourceUrl: 'https://x.com/q', savedAt: '2026-01-01' }]);
  assert.equal(legacy[0].status, 'uploaded');
  assert.equal(legacy[0].sourceHost, 'x.com');
  assert.ok(CONFIRMED.has('uploaded') && !CONFIRMED.has('captured') && !CONFIRMED.has('failed'));
  assert.equal(makeExcerpt('x'.repeat(900)).length, 500);
  assert.equal(makeExcerpt('password = "hunter2hunter2"', { hasSecrets: scanForSecrets('password = "hunter2hunter2"').length > 0 }), '');
  assert.equal(makeExcerpt('abc', { enabled: false }), '');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('line diff', () => {
  const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.deepEqual(d.ops.map((o) => o.type + o.text), ['samea', 'delb', 'addB', 'samec', 'addd', 'same']);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.equal(diffLines('x', 'x').added, 0);
  const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
  assert.equal(diffLines(big, big.replace(/l(\d+)/g, 'm$1')).tooLarge, true);
  const ctx = withContext(diffLines(Array.from({ length: 20 }, (_, i) => i).join('\n'), Array.from({ length: 20 }, (_, i) => (i === 10 ? 'X' : i)).join('\n')).ops, 2);
  assert.equal(ctx[0].type, 'skip');
  assert.equal(ctx.filter((o) => o.type !== 'skip').length, 6);
});

test('GitHub client validates write responses and lists file commits', async () => {
  const resp = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const put = (c) => c.putFile('o/r', 'a.py', { content: 'x', message: 'm', branch: 'main' });
  let e = await put(new GitHubClient('t', { fetchImpl: resp({ content: { path: 'a.py' }, commit: {} }, 201) })).catch((x) => x);
  assert.equal(e.kind, 'unexpected', 'missing commit sha is not reported as success');
  e = await put(new GitHubClient('t', { fetchImpl: resp({ content: { path: 'other.py' }, commit: { sha: 'a'.repeat(40) } }, 201) })).catch((x) => x);
  assert.equal(e.kind, 'unexpected', 'mismatched path is not reported as success');
  const ok = await put(new GitHubClient('t', { fetchImpl: resp({ content: { path: 'a.py', html_url: 'javascript:alert(1)' }, commit: { sha: 'b'.repeat(40), html_url: 'https://github.com/o/r/commit/b' } }, 201) }));
  assert.equal(ok.commitSha, 'b'.repeat(40));
  assert.equal(ok.htmlUrl, '', 'non-GitHub links are dropped');
  let seen = '';
  const list = await new GitHubClient('t', { fetchImpl: async (url) => { seen = url; return new Response(JSON.stringify([{ sha: 'c'.repeat(40), html_url: 'https://github.com/o/r/commit/c', commit: { message: 'First line\nbody', author: { date: '2026-01-01T00:00:00Z', name: 'N' } } }, { sha: 'not-a-sha' }]), { status: 200 }); } })
    .listFileCommits('o/r', 'a b/c.py', 'feat/x');
  assert.equal(seen, 'https://api.github.com/repos/o/r/commits?path=a%20b%2Fc.py&sha=feat%2Fx&per_page=20');
  assert.equal(list.length, 1);
  assert.equal(list[0].message, 'First line');
  assert.ok(isSha('a'.repeat(40)) && !isSha('A'.repeat(40)) && !isSha('abc'));
  assert.equal(safeGitHubUrl('https://github.com.evil.com/'), '');
});
