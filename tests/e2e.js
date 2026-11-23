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

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // global install works via require; add it as a devDependency if missing
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
const TOKEN = 'github_pat_TESTTOKEN_not_real_0000000000';
function json(route, status, body) { return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
function sha(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); }

async function githubMock(route) {
  const req = route.request();
  const url = new URL(req.url());
  const auth = req.headers()['authorization'];
  if (auth !== `Bearer ${TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
  const p = decodeURIComponent(url.pathname);
  if (p === '/user') return json(route, 200, { login: 'test-user' });
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
      const key = `${url.searchParams.get('ref')}:${filePath}`;
      if (!files.has(key)) return json(route, 404, { message: 'Not Found' });
      const content = files.get(key);
      return json(route, 200, { type: 'file', sha: sha(content), encoding: 'base64', content: Buffer.from(content).toString('base64').replace(/(.{60})/g, '$1\n'), html_url: `https://github.com/test-user/coding-notes/blob/main/${filePath}` });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      const key = `${body.branch}:${filePath}`;
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      if (files.has(key) && body.sha !== sha(files.get(key))) return json(route, 422, { message: '"sha" wasn\'t supplied.' });
      files.set(key, content);
      puts.push({ path: filePath, body, content });
      return json(route, files.has(key) && body.sha ? 200 : 201, { content: { html_url: `https://github.com/test-user/coding-notes/blob/${body.branch}/${filePath}`, sha: sha(content) }, commit: { html_url: 'https://github.com/test-user/coding-notes/commit/abc' } });
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
<pre id="xss">&lt;img src=x onerror="document.title='pwned'"&gt;&lt;script&gt;alert(1)&lt;/script&gt;</pre>`;

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
await site.goto('http://gcp.test/tutorial');

async function captureSelection(selector, { waitForRepos = true } = {}) {
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
  await sw.evaluate(async ({ collapsed }) => {
    const [tab] = await chrome.tabs.query({ url: 'http://gcp.test/*' });
    const r = await globalThis.__gcpCapture(tab, { frameId: 0, pageUrl: tab.url, selectionText: collapsed });
    if (!r.ok) throw new Error(r.error);
  }, { collapsed });
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
  assert.match(puts[0].body.message, /^Add fibonacci\n\nNeeds memoization\.\n\nSource title: Recursion in Python - Tutorial\nSource URL: http:\/\/gcp\.test\/tutorial\nCaptured: .+\nLanguage: Python\nSaved with Git Code Port$/);
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
  review = await captureSelection('#py code');
  await review.click('#to-confirm');
  await review.click('#do-push');
  await review.waitForSelector('#screen-conflict:not([hidden])');
  assert.equal(await review.textContent('#x-existing'), 'print("old version")\n');
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
  assert.equal(puts.at(-1).body.message, 'Add fib_plain\n\nSaved with Git Code Port');
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
  assert.match(r.error, /No code selected/);
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
