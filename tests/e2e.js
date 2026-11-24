// End-to-end test: loads the unpacked extension in Chromium, captures a real selection from a
// test page, and drives the review UI against a mocked GitHub API (no network, no real token).
//
//   node tests/e2e.js [--screenshots <dir>]
//
// The context-menu click itself cannot be simulated headlessly, so the test calls the same
// handler the menu uses. Because no real click happens, activeTab is not granted; the test copy
// of the extension therefore gets a temporary "<all_urls>" host permission. The shipped manifest
// does not have it.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // devDependency (npm ci); a global install also works
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsArg = process.argv.indexOf('--screenshots');
const shotsDir = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

// ---- copy extension with a test-only host permission ----
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcp-ext-'));
for (const f of ['manifest.json', 'src', 'assets']) fs.cpSync(path.join(root, f), path.join(extDir, f), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('<all_urls>');
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));

// ---- mock GitHub ----
const files = new Map(); // "branch:path" -> content
const puts = [];
const commits = []; // { sha, path, branch, content, message, date }
const BIG = 'x'.repeat(1100 * 1024);
const TOKEN = 'github_pat_TESTTOKEN_not_real_0000000000';
function json(route, status, body) { return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
function sha(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); }

async function githubMock(route) {
  const req = route.request();
  const url = new URL(req.url());
  const auth = req.headers()['authorization'];
  if (auth !== `Bearer ${TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
  const p = decodeURIComponent(url.pathname);
  if (p === '/user') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'github-authentication-token-expiration': '2099-01-01 00:00:00 UTC' }, body: JSON.stringify({ login: 'test-user' }) });
  if (p === '/repos/test-user/coding-notes/commits') {
    const path = url.searchParams.get('path');
    const branch = url.searchParams.get('sha');
    const list = commits.filter((c) => c.path === path && c.branch === branch).slice().reverse();
    return json(route, 200, list.map((c) => ({ sha: c.sha, html_url: `https://github.com/test-user/coding-notes/commit/${c.sha}`, commit: { message: c.message, author: { name: 'Test', date: c.date } }, author: { login: 'test-user' } })));
  }
  if (p === '/user/repos') return json(route, 200, [
    { full_name: 'test-user/coding-notes', default_branch: 'main', private: false, archived: false, permissions: { push: true } },
    { full_name: 'test-user/read-only', default_branch: 'main', private: false, archived: false, permissions: { push: false } },
  ]);
  let m;
  if ((m = p.match(/^\/repos\/test-user\/coding-notes\/branches$/))) return json(route, 200, [{ name: 'main' }, { name: 'dev' }]);
  if ((m = p.match(/^\/repos\/test-user\/coding-notes\/branches\/(.+)$/))) return ['main', 'dev'].includes(m[1]) ? json(route, 200, { name: m[1] }) : json(route, 404, { message: 'Branch not found' });
  if (p === '/repos/test-user/coding-notes') return json(route, 200, { full_name: 'test-user/coding-notes' });
  if ((m = p.match(/^\/repos\/test-user\/coding-notes\/contents\/(.+)$/))) {
    const filePath = m[1];
    if (req.method() === 'GET') {
      const ref = url.searchParams.get('ref');
      let content;
      if (/^[0-9a-f]{40}$/.test(ref)) {
        const c = commits.find((x) => x.sha === ref && x.path === filePath);
        if (!c) return json(route, 404, { message: 'Not Found' });
        content = c.content;
      } else {
        const key = `${ref}:${filePath}`;
        if (!files.has(key)) return json(route, 404, { message: 'Not Found' });
        content = files.get(key);
      }
      return json(route, 200, { type: 'file', sha: sha(content), encoding: 'base64', content: Buffer.from(content).toString('base64').replace(/(.{60})/g, '$1\n'), html_url: `https://github.com/test-user/coding-notes/blob/main/${filePath}` });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      const key = `${body.branch}:${filePath}`;
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      if (files.has(key) && body.sha !== sha(files.get(key))) return json(route, 422, { message: '"sha" wasn\'t supplied.' });
      files.set(key, content);
      puts.push({ path: filePath, body, content });
      const commitSha = crypto.createHash('sha1').update(`${commits.length}:${filePath}:${content}`).digest('hex');
      commits.push({ sha: commitSha, path: filePath, branch: body.branch, content, message: body.message, date: new Date(Date.now() + commits.length * 1000).toISOString() });
      return json(route, body.sha ? 200 : 201, { content: { path: filePath, html_url: `https://github.com/test-user/coding-notes/blob/${body.branch}/${filePath}`, sha: sha(content) }, commit: { sha: commitSha, html_url: `https://github.com/test-user/coding-notes/commit/${commitSha}` } });
    }
  }
  return json(route, 404, { message: `unmocked ${req.method()} ${p}` });
}

// ---- test pages ----
const PY = 'def fibonacci(n):\n    if n <= 1:\n        return n\n\treturn fibonacci(n - 1) + fibonacci(n - 2)  # tab + unicode ✓';
const PAGE = `<!doctype html><title>Recursion in Python - Tutorial</title>
<h1>Tutorial</h1><p>Some prose.</p>
<pre id="py"><code class="language-python">${PY.replace(/</g, '&lt;')}</code></pre>
<pre id="secret">API_KEY = "AKIAIOSFODNN7EXAMPLE"\npassword = "hunter2hunter2"</pre>
<pre id="xss">&lt;img src=x onerror="document.title='pwned'"&gt;&lt;script&gt;alert(1)&lt;/script&gt;</pre>
<ul id="notes"><li>Arrays are stored contiguously</li><li>Linked lists use pointers</li><li>Hash maps give O(1) average lookup</li></ul>
<pre id="cmds">git checkout -b feature
git add .
git commit -m "work"</pre>
<pre id="big">${BIG}</pre>`;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcp-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 820, height: 900 },
  deviceScaleFactor: shotsDir ? 2 : 1,
});
await context.route('https://api.github.com/**', githubMock);
await context.route('http://gcp.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

// Close the welcome/options tab opened on install, then connect a (fake) token.
await new Promise((r) => setTimeout(r, 500));
for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
await sw.evaluate(async ({ token }) => {
  await chrome.storage.session.set({ githubToken: token });
  await chrome.storage.local.set({ settings: { githubLogin: 'test-user', folderTemplate: '{language}' } });
}, { token: TOKEN });

const site = await context.newPage();
await site.goto('http://gcp.test/tutorial?session=SECRET123#frag');

async function captureSelection(selector, { waitForRepos = true, category } = {}) {
  await site.bringToFront();
  const collapsed = await site.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    return s.toString().replace(/\s+/g, ' '); // what info.selectionText would look like
  }, selector);
  const reviewPromise = context.waitForEvent('page');
  await sw.evaluate(async ({ collapsed, category }) => {
    const [tab] = await chrome.tabs.query({ url: 'http://gcp.test/*' });
    const r = await globalThis.__gcpCapture(tab, { frameId: 0, pageUrl: tab.url, selectionText: collapsed, category });
    if (!r.ok) throw new Error(r.error);
  }, { collapsed, category });
  const review = await reviewPromise;
  await review.waitForLoadState('domcontentloaded');
  await review.waitForSelector('#screen-review:not([hidden])');
  if (waitForRepos) await review.waitForFunction(() => document.querySelector('#repo').value !== '');
  return review;
}

let review;
await step('context-menu capture opens review window with exact selection (indentation, tabs, unicode)', async () => {
  review = await captureSelection('#py code');
  assert.ok(review.url().startsWith(`chrome-extension://${extId}/src/review/review.html?id=`));
  assert.equal(await review.inputValue('#code'), PY);
  assert.equal(await review.isHidden('#fallback-note'), true);
});

await step('suggests language, filename, folder, repo, branch, commit; hides read-only repos', async () => {
  assert.equal(await review.inputValue('#language'), 'python');
  assert.equal(await review.inputValue('#filename'), 'fibonacci.py');
  assert.equal(await review.inputValue('#folder'), 'Python');
  assert.equal(await review.inputValue('#repo'), 'test-user/coding-notes');
  assert.equal(await review.inputValue('#branch'), 'main');
  assert.equal(await review.inputValue('#commit'), 'Add fibonacci');
  const options = await review.$$eval('#repo option', (os) => os.map((o) => o.value));
  assert.deepEqual(options, ['test-user/coding-notes']);
  assert.equal(await review.textContent('#dest-preview'), 'test-user/coding-notes @ main : Python/fibonacci.py');
  assert.match(await review.textContent('#source-url'), /^http:\/\/gcp\.test\/tutorial/);
});

if (shotsDir) await review.screenshot({ path: path.join(shotsDir, '1-review.png'), fullPage: true });

await step('invalid path is blocked before any API write', async () => {
  await review.fill('#folder', 'Python/../secret');
  await review.click('#to-confirm');
  assert.equal(await review.isVisible('#form-errors'), true);
  assert.equal(await review.isVisible('#screen-review'), true);
  await review.fill('#folder', 'Python/Recursion');
});

await step('folder suggestions and step indicator are shown', async () => {
  const folders = await review.$$eval('#folder-list option', (os) => os.map((o) => o.value));
  for (const f of ['Python', 'Snippets', 'DSA', 'LeetCode', 'GeeksForGeeks', 'Codeforces']) assert.ok(folders.includes(f), `missing ${f}`);
  assert.equal(await review.getAttribute('#stepper li.active', 'data-step'), 'review');
});

await step('confirm screen then push creates the file with notes and source metadata in the commit', async () => {
  await review.click('summary');
  await review.fill('#notes', 'Needs memoization.');
  await review.click('#to-confirm');
  assert.equal(await review.getAttribute('#stepper li.active', 'data-step'), 'confirm');
  await review.waitForSelector('#screen-confirm:not([hidden])');
  assert.equal(await review.textContent('#c-path'), 'Python/Recursion/fibonacci.py');
  if (shotsDir) await review.screenshot({ path: path.join(shotsDir, '2-confirm.png'), fullPage: true });
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, 'Python/Recursion/fibonacci.py');
  assert.equal(puts[0].content, PY);
  assert.equal(puts[0].body.branch, 'main');
  assert.equal(puts[0].body.sha, undefined);
  assert.match(puts[0].body.message, /^Add fibonacci\n\nNeeds memoization\.\n\nSource title: Recursion in Python - Tutorial\nSource URL: http:\/\/gcp\.test\/tutorial\nCaptured: .+\nCategory: Code\nLanguage: Python\nTags: python\nSaved with Git Code Port$/);
  assert.ok(!puts[0].body.message.includes('SECRET123'), 'query string is not recorded by default');
  assert.equal(await review.getAttribute('#s-link', 'href'), 'https://github.com/test-user/coding-notes/blob/main/Python/Recursion/fibonacci.py');
  assert.equal(await review.getAttribute('#stepper li.active', 'data-step'), 'done');
  if (shotsDir) await review.screenshot({ path: path.join(shotsDir, '4-success.png'), fullPage: true });
  await review.close();
});

await step('identical file already on GitHub is reported without a duplicate commit', async () => {
  review = await captureSelection('#py code');
  await review.fill('#folder', 'Python/Recursion');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(await review.textContent('#s-title'), 'This exact file is already on GitHub');
  assert.equal(puts.length, 1);
  await review.close();
});

await step('existing file with different content: conflict screen, nothing overwritten, save as another file', async () => {
  files.set('main:Python/fibonacci.py', 'print("old version")\n');
  commits.push({ sha: 'f'.repeat(40), path: 'Python/fibonacci.py', branch: 'main', content: 'print("old version")\n', message: 'Initial version', date: '2026-01-01T00:00:00Z' });
  review = await captureSelection('#py code');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-conflict:not([hidden])');
  assert.equal(await review.textContent('#x-existing'), 'print("old version")\n');
  assert.match(await review.textContent('#x-diff'), /4 lines added, 2 removed/);
  assert.equal(await review.$$eval('#x-diff .diff-del', (e) => e.map((x) => x.textContent)).then((d) => d[0]), '- print("old version")\n');
  if (shotsDir) await review.screenshot({ path: path.join(shotsDir, '3-conflict.png'), fullPage: true });
  assert.equal(puts.length, 1, 'no write happened yet');
  await review.click('#x-rename');
  await review.waitForSelector('#screen-confirm:not([hidden])');
  assert.equal(await review.textContent('#c-path'), 'Python/fibonacci-2.py');
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(puts.at(-1).path, 'Python/fibonacci-2.py');
  assert.equal(files.get('main:Python/fibonacci.py'), 'print("old version")\n');
  await review.close();
});

await step('replace existing file needs a second explicit confirmation and sends the SHA', async () => {
  review = await captureSelection('#py code');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-conflict:not([hidden])');
  const before = puts.length;
  await review.click('#x-update'); // reveals confirmation only
  await review.click('#x-update'); // checkbox not ticked: still nothing
  assert.equal(puts.length, before);
  await review.check('#x-update-confirm');
  await review.click('#x-update');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(puts.length, before + 1);
  assert.equal(puts.at(-1).body.sha, sha('print("old version")\n'));
  assert.match(puts.at(-1).body.message, /^Update fibonacci/);
  assert.equal(await review.textContent('#s-title'), 'Updated on GitHub');
  await review.close();
});

await step('source metadata can be left out of the commit', async () => {
  review = await captureSelection('#py code');
  await review.fill('#filename', 'fib_plain.py');
  await review.click('summary');
  await review.uncheck('#add-source-commit');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(puts.at(-1).body.message, 'Add fib_plain\n\nCategory: Code\nLanguage: Python\nTags: python\nSaved with Git Code Port');
  assert.equal(puts.at(-1).content, PY, 'code file has no metadata added');
  await review.close();
});

await step('empty selection does not open a review window', async () => {
  await site.bringToFront();
  await site.evaluate(() => window.getSelection().removeAllRanges());
  const before = context.pages().length;
  const r = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://gcp.test/*' });
    return globalThis.__gcpCapture(tab, {});
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /Nothing is selected/);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(context.pages().length, before);
});

await step('popup capture button reports a clear error on a page it cannot read', async () => {
  const pop = await context.newPage();
  await pop.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await pop.waitForFunction(() => document.querySelector('#status').textContent !== 'Checking…');
  assert.match(await pop.textContent('#status'), /Connected to GitHub as @test-user/);
  if (shotsDir) await pop.screenshot({ path: path.join(shotsDir, '0-popup.png'), clip: { x: 0, y: 0, width: 360, height: await pop.evaluate(() => document.body.scrollHeight) } });
  await pop.click('#capture');
  await pop.waitForSelector('#capture-error:not([hidden])');
  // The popup was opened as a tab here, so the active tab is the extension page itself.
  assert.match(await pop.textContent('#capture-error'), /does not allow extensions/);
  await pop.close();
});

await step('missing branch gives a clear error and no write', async () => {
  review = await captureSelection('#py code');
  await review.fill('#branch', 'does-not-exist');
  const before = puts.length;
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-error:not([hidden])');
  assert.match(await review.textContent('#e-message'), /Branch "does-not-exist" does not exist/);
  assert.equal(puts.length, before);
  await review.close();
});

await step('secrets are flagged and push is blocked until acknowledged', async () => {
  review = await captureSelection('#secret');
  assert.equal(await review.isVisible('#secret-panel'), true);
  const items = await review.$$eval('#secret-list li', (l) => l.map((x) => x.textContent));
  assert.deepEqual([...new Set(items.map((t) => t.match(/^Line (\d+)/)[1]))], ['1', '2']);
  assert.ok(!items.join(' ').includes('hunter2hunter2'), 'secret values are masked');
  await review.fill('#filename', 'config.txt');
  await review.click('#to-confirm');
  assert.equal(await review.isDisabled('#do-push'), true);
  await review.check('#c-secret-ack');
  assert.equal(await review.isDisabled('#do-push'), false);
  await review.close();
});

await step('HTML/script in the selection is shown as text, never rendered', async () => {
  review = await captureSelection('#xss');
  assert.match(await review.inputValue('#code'), /^<img src=x onerror=/);
  await review.fill('#filename', 'x.html');
  await review.click('#to-confirm');
  assert.equal(await review.$$eval('img[src="x"], script:not([src])', (e) => e.length), 0);
  assert.notEqual(await review.title(), 'pwned');
  await review.close();
});

await step('revoked token shows an auth error with a Settings button', async () => {
  await sw.evaluate(async () => { await chrome.storage.session.set({ githubToken: 'github_pat_REVOKED' }); await chrome.storage.local.remove('repoCache'); });
  review = await captureSelection('#py code', { waitForRepos: false });
  await review.waitForSelector('#form-errors:not([hidden])', { timeout: 5000 }).catch(async (e) => {
    console.log(await review.evaluate(() => document.querySelector('main').innerText.slice(0, 600)));
    throw e;
  });
  assert.match(await review.textContent('#form-errors'), /rejected the token/);
  assert.equal(await review.isVisible('#connect-banner'), true);
  await review.close();
});

await step('settings page connects with a token, then disconnect clears it', async () => {
  await sw.evaluate(async () => { await chrome.storage.session.remove('githubToken'); });
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opt.waitForSelector('#connect-form:not([hidden])');
  await opt.fill('#token', 'not-a-token');
  await opt.click('#connect-btn');
  assert.match(await opt.textContent('#connect-error'), /does not look like a GitHub token/);
  await opt.fill('#token', TOKEN);
  await opt.click('#connect-btn');
  await opt.waitForSelector('#connected:not([hidden])');
  assert.equal(await opt.textContent('#login'), '@test-user');
  assert.match(await opt.textContent('#token-where'), /until the browser closes/);
  const stored = await sw.evaluate(async () => ({ s: (await chrome.storage.session.get('githubToken')).githubToken, l: (await chrome.storage.local.get('githubToken')).githubToken }));
  assert.equal(stored.s, TOKEN);
  assert.equal(stored.l, undefined, 'not persisted unless Remember is ticked');
  assert.ok((await opt.$$eval('#history li a', (a) => a.length)) >= 3, 'recent saves listed');
  if (shotsDir) await opt.screenshot({ path: path.join(shotsDir, '5-settings.png'), fullPage: true });
  await opt.click('#disconnect');
  await opt.waitForSelector('#connect-form:not([hidden])');
  const after = await sw.evaluate(async () => (await chrome.storage.session.get('githubToken')).githubToken);
  assert.equal(after, undefined);
  await opt.close();
});


// The settings test above disconnected; reconnect the fake token for the V2 checks.
await sw.evaluate(async ({ token }) => {
  await chrome.storage.session.set({ githubToken: token });
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, githubLogin: 'test-user' } });
}, { token: TOKEN });

await step('notes are classified, saved as Markdown in Learning/Notes, content unchanged', async () => {
  review = await captureSelection('#notes');
  assert.equal(await review.inputValue('#category'), 'notes');
  assert.equal(await review.inputValue('#format'), 'md');
  assert.equal(await review.inputValue('#folder'), 'Learning/Notes');
  assert.match(await review.inputValue('#filename'), /\.md$/);
  const text = await review.inputValue('#code');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  assert.equal(puts.at(-1).content, text);
  assert.match(puts.at(-1).path, /^Learning\/Notes\/.+\.md$/);
  assert.match(puts.at(-1).body.message, /\nCategory: Study notes\n/);
  await review.close();
});

await step('"Save as commands" menu choice saves a fenced Markdown file under Developer-Tools/Git', async () => {
  review = await captureSelection('#cmds', { category: 'commands' });
  assert.equal(await review.inputValue('#category'), 'commands');
  assert.equal(await review.inputValue('#format'), 'md-code');
  assert.equal(await review.inputValue('#folder'), 'Developer-Tools/Git');
  assert.equal(await review.inputValue('#filename'), 'git-commands.md');
  await review.click('#to-confirm');
  assert.match(await review.textContent('#c-preview'), /^```\ngit checkout -b feature\n[\s\S]+\n```\n$/);
  await review.click('#do-push');
  await review.waitForSelector('#screen-success:not([hidden])');
  await review.close();
});

await step('identical content saved before is flagged on the confirm screen', async () => {
  review = await captureSelection('#notes');
  await review.fill('#filename', 'notes-copy.md');
  await review.click('#to-confirm');
  await review.waitForSelector('#c-duplicate:not([hidden])');
  assert.match(await review.textContent('#c-duplicate-list'), /test-user\/coding-notes\/Learning\/Notes\//);
  await review.close();
});

await step('selections over 1 MB are refused with a clear message, nothing stored', async () => {
  await site.bringToFront();
  await site.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#big')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  const r = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://gcp.test/*' });
    const res = await globalThis.__gcpCapture(tab, { frameId: 0 });
    const keys = Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith('capture:'));
    return { res, keys: keys.length };
  });
  assert.equal(r.res.ok, false);
  assert.match(r.res.error, /too large \(1\.1 MB\)/);
});

await step('service worker rejects malformed or unknown messages from extension pages', async () => {
  const pg = await context.newPage();
  await pg.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  const out = await pg.evaluate(async () => Promise.all([
    chrome.runtime.sendMessage({ type: 'capture-active-tab', category: 'evil' }),
    chrome.runtime.sendMessage({ type: 'push-file', path: 'x' }),
    chrome.runtime.sendMessage({ type: 'capture-active-tab', tabId: 1 }),
    chrome.runtime.sendMessage('capture-active-tab'),
  ]));
  for (const r of out) assert.deepEqual(r, { ok: false, error: 'Request rejected.' });
  await pg.close();
});

let panel;
await step('side panel: navigation, home recent list, explore cards', async () => {
  await sw.evaluate(async () => {
    // A hostile title in the index must render as text.
    const { captureIndex } = await chrome.storage.local.get('captureIndex');
    captureIndex.push({ id: 'evil', status: 'captured', title: '<img src=x onerror="document.title=\'pwned\'">', category: 'resource', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z' });
    await chrome.storage.local.set({ captureIndex });
  });
  panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#home-recent li .entry');
  assert.match(await panel.textContent('#home-account'), /Connected to GitHub as @test-user/);
  assert.equal(await panel.$$eval('#home-recent li', (l) => l.length), 5);
  await panel.click('#tab-explore');
  assert.equal(await panel.isVisible('#view-explore'), true);
  assert.equal(await panel.isHidden('#view-home'), true);
  assert.equal(await panel.$$eval('#explore-list article', (a) => a.length), 5);
  await panel.press('#tab-explore', 'ArrowRight');
  assert.equal(await panel.isVisible('#view-capture'), true, 'arrow keys move between tabs');
  assert.equal(await panel.$$eval('#view-capture .quick', (q) => q.length), 6);
  if (shotsDir) { await panel.click('#tab-home'); await panel.screenshot({ path: path.join(shotsDir, '6-sidepanel-home.png'), fullPage: true }); }
});

await step('side panel: history search, filters, states and safe rendering', async () => {
  await panel.click('#tab-history');
  await panel.waitForSelector('#h-list li .entry');
  const total = await panel.$$eval('#h-list li', (l) => l.length);
  assert.ok(total >= 8, `expected history entries, got ${total}`);
  assert.equal(await panel.$$eval('img[src="x"]', (i) => i.length), 0);
  assert.notEqual(await panel.title(), 'pwned');
  await panel.fill('#h-search', 'git-commands');
  await panel.waitForFunction(() => document.querySelectorAll('#h-list li .entry').length === 1);
  await panel.fill('#h-search', '');
  await panel.selectOption('#h-category', 'notes');
  await panel.waitForFunction(() => [...document.querySelectorAll('#h-list .entry-meta')].every((m) => m.textContent.includes('Study notes')));
  await panel.selectOption('#h-category', '');
  await panel.selectOption('#h-status', 'local');
  const local = await panel.$$eval('#h-list .badge', (b) => b.map((x) => x.textContent));
  assert.ok(local.length && local.every((t) => !['Uploaded', 'Updated on GitHub', 'Already on GitHub', 'Restored on GitHub'].includes(t)), local.join(','));
  await panel.selectOption('#h-status', '');
  if (shotsDir) await panel.screenshot({ path: path.join(shotsDir, '7-sidepanel-history.png'), fullPage: true });
});

await step('side panel: version history, compare and restore with explicit confirmation', async () => {
  await panel.fill('#h-search', 'fibonacci.py');
  await panel.waitForFunction(() => [...document.querySelectorAll('#h-list .entry-title')].some((t) => t.textContent === 'fibonacci.py'));
  await panel.click('#h-list .entry:has(.badge:text-is("Updated on GitHub"))');
  await panel.waitForSelector('#history-detail:not([hidden])');
  assert.equal(await panel.textContent('#d-path'), 'Python/fibonacci.py');
  assert.match(await panel.textContent('#d-commit'), /^[0-9a-f]{7}$/);
  await panel.click('#d-versions-btn');
  await panel.waitForSelector('#d-versions-list li');
  assert.equal(await panel.$$eval('#d-versions-list li', (l) => l.length), 2);
  await panel.click('#d-versions-list li:nth-child(2) button:text("Compare with current")');
  await panel.waitForSelector('#d-compare-diff .diff');
  const before = puts.length;
  await panel.click('#d-versions-list li:nth-child(2) button:text("Restore…")');
  await panel.waitForSelector('#confirm-dialog[open]');
  assert.match(await panel.textContent('#cd-body'), /Python\/fibonacci\.py/);
  assert.equal(await panel.isDisabled('#cd-ok'), true, 'restore needs the checkbox');
  if (shotsDir) await panel.screenshot({ path: path.join(shotsDir, '8-sidepanel-restore.png'), fullPage: true });
  await panel.check('#cd-check');
  await panel.click('#cd-ok');
  await panel.waitForFunction(() => document.querySelector('#d-status').textContent === 'Restored on GitHub');
  assert.equal(puts.length, before + 1);
  assert.equal(puts.at(-1).content, 'print("old version")\n');
  assert.ok(puts.at(-1).body.sha, 'restore sends the current SHA');
  assert.match(puts.at(-1).body.message, /^Restore fibonacci\.py to [0-9a-f]{7}/);
  await panel.click('#d-back');
  await panel.fill('#h-search', '');
});

await step('side panel: repositories and settings (token type and expiry, privacy toggles)', async () => {
  await panel.click('#tab-repos');
  await panel.waitForSelector('#r-list li.repo');
  assert.equal(await panel.$$eval('#r-list li.repo', (l) => l.length), 1);
  await panel.click('#r-list li.repo button:text("Make default")');
  await panel.waitForSelector('#r-list li.repo button:text("Default ✓")');
  const s1 = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.defaultRepo);
  assert.equal(s1, 'test-user/coding-notes');
  await panel.click('#tab-settings');
  await panel.waitForFunction(() => /Fine-grained personal access token · expires/.test(document.querySelector('#s-account').textContent));
  assert.equal(await panel.isChecked('#s-full-url'), false);
  await panel.check('#s-full-url');
  await panel.selectOption('#s-theme', 'dark');
  await panel.click('#s-form button[type=submit]');
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const s2 = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.equal(s2.fullSourceUrl, true);
  if (shotsDir) await panel.screenshot({ path: path.join(shotsDir, '9-sidepanel-settings-dark.png'), fullPage: true });
  await panel.selectOption('#s-theme', 'system');
  await panel.uncheck('#s-full-url');
  await panel.click('#s-form button[type=submit]');
});

await step('side panel quick capture is wired to the service worker and reports errors', async () => {
  await panel.click('#tab-capture');
  // The test build holds <all_urls>, so the optional permission counts as granted.
  assert.equal(await panel.isHidden('#perm-card'), true);
  await panel.click('#view-capture .quick[data-category="notes"]');
  await panel.waitForSelector('#view-capture .capture-result:not([hidden])');
  // The active tab is the side panel page itself here (opened as a tab), which cannot be read.
  assert.match(await panel.textContent('#view-capture .capture-result'), /does not allow extensions/);
  await panel.close();
});

await step('token never appears in page URLs', async () => {
  const urls = context.pages().map((p) => p.url()).join(' ');
  assert.ok(!urls.includes(TOKEN));
});

await context.close();
fs.rmSync(extDir, { recursive: true, force: true });
fs.rmSync(userDataDir, { recursive: true, force: true });
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed`);
process.exit(failed ? 1 : 0);
