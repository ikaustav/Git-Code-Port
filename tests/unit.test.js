import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, languageFromExtension } from '../src/processing/languages.js';
import { suggestFilename, suggestFolder, suggestCommitMessage, metadataTrailer, sourceHeader, platformFromUrl, titleWords } from '../src/processing/filename.js';
import { isRestrictedUrl } from '../src/capture/capture.js';
import { scanForSecrets } from '../src/processing/secret-scan.js';
import { validatePath, validateBranch, validateContent, nextAvailableName, sanitizeFilename } from '../src/utils/validation.js';
import { utf8ToBase64, base64ToUtf8, normalizeNewlines } from '../src/utils/encoding.js';
import { GitHubClient } from '../src/github/api.js';

const SAMPLES = {
  python: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n',
  java: 'public class TwoSum {\n    public static void main(String[] args) {\n        System.out.println("hi");\n    }\n}\n',
  cpp: '#include <iostream>\nusing namespace std;\nint main() {\n  cout << "hi" << endl;\n}\n',
  c: '#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}\n',
  javascript: "const add = (a, b) => a + b;\nconsole.log(add(1, 2));\n",
  typescript: 'interface User {\n  name: string;\n  age: number;\n}\nfunction greet(u: User): string { return u.name; }\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n',
  rust: 'fn main() {\n    let mut x = 5;\n    println!("{}", x);\n}\n',
  sql: 'SELECT name, COUNT(*) FROM users WHERE active = 1 GROUP BY name;',
  bash: '#!/bin/bash\nfor f in *.txt; do\n  echo "$f"\ndone\n',
  json: '{"a": 1, "b": [true, null]}',
  html: '<!DOCTYPE html>\n<html><body><div>Hi</div></body></html>',
  dockerfile: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "index.js"]\n',
  php: '<?php\n$x = 1;\necho $x;\n',
  csharp: 'using System;\nclass P { static void Main() { Console.WriteLine("hi"); } }',
  ruby: "require 'json'\n[1,2].each do |x|\n  puts x\nend\n",
  yaml: 'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n',
  css: '.card {\n  margin: 0 auto;\n  padding: 8px;\n}\n@media (max-width: 600px) {\n  .card { display: none; }\n}\n',
};

test('detects common languages from code alone', () => {
  for (const [lang, code] of Object.entries(SAMPLES)) {
    assert.equal(detectLanguage(code).id, lang, `expected ${lang}`);
  }
});

test('uses page language hint', () => {
  assert.equal(detectLanguage('x = 1\ny = 2', { languageHint: 'python' }).id, 'python');
  assert.equal(detectLanguage('hello world').id, 'text');
});

test('language from filename extension', () => {
  assert.equal(languageFromExtension('a/b/thing.tsx'), 'typescript');
  assert.equal(languageFromExtension('Dockerfile'), 'dockerfile');
  assert.equal(languageFromExtension('x.py'), 'python');
  assert.equal(languageFromExtension('noext'), null);
});

test('filename suggestions', () => {
  assert.equal(suggestFilename(SAMPLES.python, 'python'), 'fibonacci.py');
  assert.equal(suggestFilename(SAMPLES.java, 'java'), 'TwoSum.java');
  assert.equal(suggestFilename('public class Solution { }', 'java'), 'Solution.java');
  assert.equal(suggestFilename('x = 1', 'python', { title: 'Two Sum - LeetCode' }), 'two_sum.py');
  assert.equal(suggestFilename('let x = 1', 'javascript', { title: 'New Tab' }), 'snippet.js');
  assert.equal(suggestFilename('FROM x', 'dockerfile'), 'Dockerfile');
  assert.equal(suggestFilename('function getUserName() {}', 'javascript'), 'get-user-name.js');
});

test('folder template and commit message', () => {
  const now = new Date(2026, 10, 23);
  assert.equal(suggestFolder('{language}', 'python', {}, now), 'Python');
  assert.equal(suggestFolder('{language}', 'cpp', {}, now), 'Cpp');
  assert.equal(suggestFolder('Snippets/{host}/{yyyy}-{mm}', 'go', { url: 'https://www.example.com/x' }, now), 'Snippets/example.com/2026-11');
  assert.equal(suggestFolder('', 'go', {}, now), '');
  assert.equal(suggestCommitMessage('fibonacci.py'), 'Add fibonacci');
  assert.match(metadataTrailer({ url: 'https://a.b/c', title: 'T' }, '2026-01-01T00:00:00Z'), /Source URL: https:\/\/a\.b\/c/);
  assert.equal(sourceHeader('python', { url: 'https://a.b' }, 'now'), '# Source: https://a.b\n# Captured: now\n\n');
  assert.equal(sourceHeader('json', { url: 'https://a.b' }, 'now'), '');
  assert.ok(!sourceHeader('css', { url: 'https://a.b/*/ evil' }, 'now').includes('*/ evil'));
});

test('secret scanner flags real-looking secrets and skips placeholders', () => {
  const text = [
    'AWS_KEY = "AKIAIOSFODNN7EXAMPLE"',
    'token = "ghp_' + 'a'.repeat(36) + '"',
    'password = "hunter2hunter2"',
    'password = "changeme"',
    'api_key = "your_api_key"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'db = "postgres://admin:s3cretpw@db.example.com/app"',
    'print("hello")',
  ].join('\n');
  const f = scanForSecrets(text);
  const lines = f.map((x) => x.line);
  assert.deepEqual([...new Set(lines)].sort(), [1, 2, 3, 6, 7]);
  assert.ok(f.every((x) => !x.preview.includes('hunter2hunter2')), 'previews are masked');
  assert.equal(scanForSecrets(SAMPLES.python).length, 0);
});

test('path validation', () => {
  assert.deepEqual(validatePath('Python/fib.py'), []);
  assert.ok(validatePath('').length);
  assert.ok(validatePath('/abs.py').length);
  assert.ok(validatePath('a/../b.py').length);
  assert.ok(validatePath('a//b.py').length);
  assert.ok(validatePath('.git/config').length);
  assert.ok(validatePath('a/b?.py').length);
  assert.ok(validatePath('dir/').length);
  assert.deepEqual(validateBranch('feature/x-1'), []);
  assert.ok(validateBranch('bad..branch').length);
  assert.ok(validateBranch('has space').length);
  assert.ok(validateContent('   ').length);
  assert.equal(nextAvailableName('Python/fib.py', 2), 'Python/fib-2.py');
  assert.equal(nextAvailableName('Python/fib-2.py', 3), 'Python/fib-3.py');
  assert.equal(nextAvailableName('Dockerfile', 2), 'Dockerfile-2');
  assert.equal(sanitizeFilename('my file?.py'), 'my_file-.py');
});

test('UTF-8 base64 round trip keeps unicode, tabs and newlines', () => {
  const s = 'def f():\n\treturn "héllo ✓ 日本 🚀"\r\n';
  assert.equal(base64ToUtf8(utf8ToBase64(s)), s);
  assert.equal(utf8ToBase64('✓'), Buffer.from('✓').toString('base64'));
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc');
  const big = 'x'.repeat(200000) + '✓';
  assert.equal(base64ToUtf8(utf8ToBase64(big)), big);
});

test('GitHub client maps errors and never retries writes', async () => {
  let calls = 0;
  const fake = (status, body, headers = {}) => async () => {
    calls++;
    return new Response(JSON.stringify(body), { status, headers });
  };
  const run = async (f, fn) => { calls = 0; try { await fn(new GitHubClient('t', { fetchImpl: f })); return null; } catch (e) { return e; } };

  let e = await run(fake(401, { message: 'Bad credentials' }), (c) => c.getUser());
  assert.equal(e.kind, 'auth');
  e = await run(fake(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }), (c) => c.getUser());
  assert.equal(e.kind, 'rate_limit');
  e = await run(fake(403, { message: 'Resource not accessible by personal access token' }), (c) => c.putFile('o/r', 'a.py', { content: 'x', message: 'm', branch: 'main' }));
  assert.equal(e.kind, 'permission');
  e = await run(fake(422, { message: '"sha" wasn\'t supplied.' }), (c) => c.putFile('o/r', 'a.py', { content: 'x', message: 'm', branch: 'main' }));
  assert.equal(e.kind, 'conflict');
  e = await run(fake(502, { message: 'Bad gateway' }), (c) => c.putFile('o/r', 'a.py', { content: 'x', message: 'm', branch: 'main' }));
  assert.equal(e.kind, 'server');
  assert.equal(calls, 1, 'PUT is not retried');
  e = await run(async () => { calls++; throw new TypeError('Failed to fetch'); }, (c) => c.getUser());
  assert.equal(e.kind, 'network');
  assert.equal(calls, 3, 'GET retried with backoff');
});

test('GitHub client sends token only to api.github.com and encodes paths', async () => {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ content: { html_url: 'https://github.com/o/r/blob/main/a%20b/c.py', sha: 's' }, commit: {} }), { status: 201 });
  };
  const c = new GitHubClient('secret-token', { fetchImpl: f });
  const res = await c.putFile('o/r', 'a b/c#.py', { content: 'é', message: 'm', branch: 'main', sha: 'abc' });
  assert.equal(seen[0].url, 'https://api.github.com/repos/o/r/contents/a%20b/c%23.py');
  assert.equal(seen[0].init.method, 'PUT');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.sha, 'abc');
  assert.equal(body.content, Buffer.from('é').toString('base64'));
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret-token');
  assert.ok(res.htmlUrl.startsWith('https://github.com/'));
});

test('platform folders and problem titles', () => {
  assert.equal(platformFromUrl('https://leetcode.com/problems/two-sum/'), 'LeetCode');
  assert.equal(platformFromUrl('https://www.geeksforgeeks.org/reverse-a-linked-list/'), 'GeeksForGeeks');
  assert.equal(platformFromUrl('https://codeforces.com/problemset/problem/4/A'), 'Codeforces');
  assert.equal(platformFromUrl('https://example.com/blog'), '');
  assert.equal(platformFromUrl('not a url'), '');
  const now = new Date(2026, 10, 23);
  assert.equal(suggestFolder('DSA/{platform}', 'cpp', { url: 'https://leetcode.com/problems/x' }, now), 'DSA/LeetCode');
  assert.equal(suggestFolder('{platform}', 'cpp', { url: 'https://example.com' }, now), 'Snippets');
  assert.deepEqual(titleWords('1. Two Sum - LeetCode'), ['Two', 'Sum']);
  assert.deepEqual(titleWords('Problem - 4A - Codeforces'), ['4A']);
  assert.deepEqual(titleWords('Reverse a Linked List - GeeksforGeeks'), ['Reverse', 'a', 'Linked', 'List']);
  assert.deepEqual(titleWords('ChatGPT'), []);
  assert.equal(suggestFilename('#include <iostream>\nint main(){}', 'cpp', { title: '1. Two Sum - LeetCode' }), 'two_sum.cpp');
});

test('commit metadata is configurable and single-line safe', () => {
  const ctx = { title: 'Evil\nInjected: yes', url: 'https://a.b/c' };
  const full = metadataTrailer(ctx, '2026-01-01T00:00:00Z', { language: 'Python', notes: 'Remember the edge case.' });
  assert.match(full, /^Remember the edge case\.\n\nSource title: Evil Injected: yes\nSource URL: https:\/\/a\.b\/c\nCaptured: 2026-01-01T00:00:00Z\nLanguage: Python\nSaved with Git Code Port$/);
  const none = metadataTrailer(ctx, '2026-01-01T00:00:00Z', { includeSource: false });
  assert.equal(none, 'Saved with Git Code Port');
});

test('restricted pages are recognised', () => {
  assert.ok(isRestrictedUrl('chrome://extensions'));
  assert.ok(isRestrictedUrl('https://chromewebstore.google.com/detail/x'));
  assert.ok(!isRestrictedUrl('https://leetcode.com/problems/two-sum/'));
});

test('sanitized filenames never contain path or reserved characters', () => {
  for (const raw of ['../../etc/passwd', 'a/b\\c.py', 'con<>:"|?*.js', '  .hidden', '\u0000x.py', 'x'.repeat(500)]) {
    const out = sanitizeFilename(raw);
    assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/.test(out), `${raw} -> ${out}`);
    assert.ok(!out.startsWith('.'), out);
    assert.ok(out.length <= 120);
  }
});
