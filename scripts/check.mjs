// Static checks with no dependencies: manifest structure, referenced files, JavaScript syntax,
// unsafe APIs and accidental secrets. Run with `npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanForSecrets } from '../src/processing/secret-scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = [];
const rel = (p) => path.relative(root, p);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ---- manifest ----
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  ok.push('manifest.json is valid JSON');
} catch (e) {
  problems.push(`manifest.json: ${e.message}`);
}
if (manifest) {
  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) problems.push('version must be 1-4 dot-separated integers');
  if (manifest.background && manifest.background.scripts) problems.push('MV3 uses background.service_worker, not background.scripts');
  if (manifest.browser_action || manifest.page_action) problems.push('MV3 uses "action", not browser_action/page_action');
  const allowedPerms = new Set(['contextMenus', 'storage', 'activeTab', 'scripting']);
  for (const p of manifest.permissions || []) if (!allowedPerms.has(p)) problems.push(`unexpected permission "${p}" (update scripts/check.mjs and the README if intended)`);
  const hosts = manifest.host_permissions || [];
  if (hosts.length !== 1 || hosts[0] !== 'https://api.github.com/*') problems.push(`host_permissions should be only https://api.github.com/* (got ${JSON.stringify(hosts)})`);
  if (manifest.content_scripts) problems.push('no persistent content scripts expected');
  if (manifest.externally_connectable) problems.push('externally_connectable would let web pages message the extension');
  const csp = (manifest.content_security_policy || {}).extension_pages || '';
  if (/unsafe-eval|unsafe-inline|https?:\/\/(?!api\.github\.com)/.test(csp.replace(/connect-src[^;]*/, ''))) problems.push('CSP allows unsafe sources');
  // Every file the manifest points at must exist.
  const refs = [
    manifest.background && manifest.background.service_worker,
    manifest.action && manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ].filter(Boolean);
  for (const r of refs) if (!fs.existsSync(path.join(root, r))) problems.push(`manifest references missing file ${r}`);
  ok.push(`manifest references ${refs.length} files, permissions: ${(manifest.permissions || []).join(', ')}`);
}

const files = walk(root);
const srcFiles = files.filter((f) => rel(f).startsWith('src/'));

// ---- HTML references ----
for (const f of srcFiles.filter((x) => x.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) problems.push(`${rel(f)} references missing ${m[1]}`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${rel(f)} has an inline <script> (blocked by MV3 CSP)`);
  if (/\son[a-z]+\s*=\s*"/i.test(html)) problems.push(`${rel(f)} has an inline event handler attribute`);
}
ok.push('HTML pages reference only existing local files');

// ---- JS syntax + unsafe APIs ----
const jsFiles = files.filter((f) => /\.(m?js)$/.test(f));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { problems.push(`${rel(f)}: syntax error\n${String(e.stderr).split('\n').slice(0, 4).join('\n')}`); }
}
ok.push(`${jsFiles.length} JavaScript files pass node --check`);

const UNSAFE = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/, 'HTML string injection'],
  [/document\.write\s*\(/, 'document.write()'],
  [/setTimeout\s*\(\s*['"`]/, 'setTimeout with a string'],
  [/console\.(log|info|debug|warn|error)\s*\(/, 'console logging (could leak data)'],
];
for (const f of srcFiles.filter((x) => x.endsWith('.js'))) {
  const code = fs.readFileSync(f, 'utf8');
  for (const [re, name] of UNSAFE) if (re.test(code)) problems.push(`${rel(f)} uses ${name}`);
}
ok.push('no eval, new Function, innerHTML, document.write or console logging in src/');

// ---- secrets in tracked-looking files ----
for (const f of files.filter((x) => !/\.(png|jpg|gif|zip)$/i.test(x))) {
  if (rel(f).startsWith('tests/') || rel(f) === 'scripts/check.mjs' || rel(f) === 'src/processing/secret-scan.js') continue;
  const hits = scanForSecrets(fs.readFileSync(f, 'utf8'));
  for (const h of hits) problems.push(`${rel(f)}:${h.line} looks like a secret (${h.type})`);
}
for (const bad of ['.env', 'credentials.json', 'token.txt']) if (fs.existsSync(path.join(root, bad))) problems.push(`${bad} must not be in the repository`);
ok.push('no secrets or credential files found');

for (const o of ok) console.log(`ok    ${o}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nAll static checks passed');
process.exit(problems.length ? 1 : 0);
