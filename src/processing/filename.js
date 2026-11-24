// Filename, folder and commit-message suggestions.
import { byId } from './languages.js';
import { sanitizeFilename, joinPath } from '../utils/validation.js';
import { redactSourceUrl } from '../security/redact.js';

const GENERIC_TITLES = /^(untitled|new tab|home|index|problem|problems|submission|submissions|solution|solutions|editorial|description|chatgpt|claude|gemini|copilot|stack overflow|leetcode|geeksforgeeks|codeforces|hackerrank|codechef|atcoder|github|gist|w3schools|mdn web docs)$/i;

// Well-known coding sites -> folder names used by the {platform} template token.
const PLATFORMS = [
  [/(^|\.)leetcode\.(com|cn)$/, 'LeetCode'],
  [/(^|\.)geeksforgeeks\.org$/, 'GeeksForGeeks'],
  [/(^|\.)codeforces\.com$/, 'Codeforces'],
  [/(^|\.)hackerrank\.com$/, 'HackerRank'],
  [/(^|\.)codechef\.com$/, 'CodeChef'],
  [/(^|\.)atcoder\.jp$/, 'AtCoder'],
  [/(^|\.)hackerearth\.com$/, 'HackerEarth'],
  [/(^|\.)interviewbit\.com$/, 'InterviewBit'],
  [/(^|\.)codewars\.com$/, 'Codewars'],
  [/(^|\.)exercism\.org$/, 'Exercism'],
  [/(^|\.)stackoverflow\.com$|(^|\.)stackexchange\.com$/, 'StackOverflow'],
  [/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/, 'GitHub'],
];

/** "LeetCode" for leetcode.com, otherwise "" (unknown site). */
export function platformFromUrl(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  const hit = PLATFORMS.find(([re]) => re.test(host));
  return hit ? hit[1] : '';
}

/** Folder ideas offered in the review screen. Users can type anything else. */
export const FOLDER_PRESETS = ['Snippets', 'DSA', 'LeetCode', 'GeeksForGeeks', 'Codeforces', 'Python', 'Java', 'C', 'CPP', 'JavaScript', 'TypeScript'];

function toCase(words, style, langId) {
  const w = words.filter(Boolean).map((s) => s.toLowerCase());
  if (!w.length) return '';
  if (langId === 'java' || langId === 'csharp' || langId === 'kotlin' || langId === 'swift' || style === 'PascalCase') {
    return w.map((s) => s[0].toUpperCase() + s.slice(1)).join('');
  }
  if (langId === 'go' || langId === 'javascript' || langId === 'typescript' || style === 'kebab-case') return w.join('-');
  return w.join('_');
}

function splitWords(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6);
}

/** The main symbol name declared in the code, if any. */
export function symbolFromCode(code, langId) {
  const text = String(code || '');
  const patterns = {
    java: [/\bpublic\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/, /\bclass\s+(\w+)/],
    csharp: [/\bclass\s+(\w+)/],
    kotlin: [/\bclass\s+(\w+)/, /\bfun\s+(\w+)/],
    python: [/^\s*def\s+(\w+)/m, /^\s*class\s+(\w+)/m],
    javascript: [/\bfunction\s+(\w+)/, /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/, /\bclass\s+(\w+)/],
    typescript: [/\bfunction\s+(\w+)/, /\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/, /\b(?:class|interface)\s+(\w+)/],
    go: [/\bfunc\s+(?:\(\w+ \*?\w+\)\s*)?(\w+)\(/],
    rust: [/\bfn\s+(\w+)/, /\bstruct\s+(\w+)/],
    ruby: [/^\s*def\s+(\w+)/m, /^\s*class\s+(\w+)/m],
    php: [/\bfunction\s+(\w+)/, /\bclass\s+(\w+)/],
    swift: [/\bfunc\s+(\w+)/, /\b(?:struct|class)\s+(\w+)/],
    c: [/^\s*[\w*]+\s+\**(\w+)\s*\([^;]*\)\s*{/m],
    cpp: [/\bclass\s+(\w+)/, /^\s*[\w:<>*&]+\s+\**(\w+)\s*\([^;]*\)\s*{/m],
    sql: [/\bCREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?[`"]?(\w+)/i],
  };
  for (const re of patterns[langId] || []) {
    const m = text.match(re);
    if (m && m[1] && !/^(main|Main|Solution|__init__|constructor)$/.test(m[1])) return m[1];
  }
  // Java must match its public class name, even "Solution"/"Main".
  if (langId === 'java') {
    const m = text.match(/\bpublic\s+(?:final\s+)?class\s+(\w+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * The most useful words of a page title.
 * "1. Two Sum - LeetCode" -> Two Sum; "Problem - 4A - Codeforces" -> 4A; "How to X | Blog" -> How to X
 */
export function titleWords(title) {
  if (!title) return [];
  const segments = String(title).split(/\s+[-|–—:·]\s+/)
    .map((s) => s.replace(/^\(\d+\)\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  const pick = segments.find((s) => !GENERIC_TITLES.test(s) && s.length <= 60);
  return pick ? splitWords(pick) : [];
}

export function suggestFilename(code, langId, context = {}) {
  const lang = byId[langId] || byId.text;
  if (lang.id === 'dockerfile') return 'Dockerfile';
  const symbol = symbolFromCode(code, lang.id);
  let base = '';
  if (lang.id === 'java' && symbol) base = symbol; // must match the class name to compile
  else if (symbol) base = toCase(splitWords(symbol), null, lang.id);
  if (!base) base = toCase(titleWords(context.title), null, lang.id);
  if (!base) base = lang.id === 'java' ? 'Snippet' : 'snippet';
  return sanitizeFilename(`${base}.${lang.ext}`);
}

/**
 * Folder template tokens: {language} {platform} {host} {yyyy} {mm} {dd}
 * Example default: "{language}" -> "Python"; "{platform}" -> "LeetCode" (or "Snippets" on other sites)
 */
export function suggestFolder(template, langId, context = {}, now = new Date()) {
  const lang = byId[langId] || byId.text;
  let host = '';
  try { host = new URL(context.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const pad = (n) => String(n).padStart(2, '0');
  return String(template ?? '{language}')
    .replace(/\{language\}/gi, lang.name.replace(/\+/g, 'p').replace(/#/g, 'Sharp').replace(/[^A-Za-z0-9]/g, '') || 'Text')
    .replace(/\{platform\}/gi, platformFromUrl(context.url) || 'Snippets')
    .replace(/\{host\}/gi, host || 'unknown-site')
    .replace(/\{yyyy\}/gi, String(now.getFullYear()))
    .replace(/\{mm\}/gi, pad(now.getMonth() + 1))
    .replace(/\{dd\}/gi, pad(now.getDate()))
    .split('/').map((s) => s.trim()).filter(Boolean).join('/');
}

export function suggestPath(template, filename, langId, context, now) {
  return joinPath(suggestFolder(template, langId, context, now), filename);
}

export function suggestCommitMessage(filename, isUpdate = false) {
  const stem = filename.replace(/\.[^.]+$/, '');
  return `${isUpdate ? 'Update' : 'Add'} ${stem || filename}`;
}

const oneLine = (s, max) => String(s).replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * Commit message body. Keeps the code itself untouched.
 * @param {object} context    { title, url }
 * @param {string} capturedAt ISO time
 * @param {{ includeSource?: boolean, fullUrl?: boolean, language?: string, category?: string, tags?: string[], notes?: string }} opts
 */
export function metadataTrailer(context = {}, capturedAt, opts = {}) {
  const { includeSource = true, fullUrl = false, language = '', category = '', tags = [], notes = '' } = opts;
  const lines = [];
  const cleanNotes = String(notes || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  if (cleanNotes) lines.push(cleanNotes, '');
  if (includeSource) {
    const url = redactSourceUrl(context.url, { keepQuery: fullUrl });
    if (context.title) lines.push(`Source title: ${oneLine(context.title, 200)}`);
    if (url) lines.push(`Source URL: ${oneLine(url, 500)}`);
    if (capturedAt) lines.push(`Captured: ${capturedAt}`);
  }
  if (category) lines.push(`Category: ${oneLine(category, 40)}`);
  if (language) lines.push(`Language: ${oneLine(language, 40)}`);
  if (tags && tags.length) lines.push(`Tags: ${oneLine(tags.join(', '), 200)}`);
  lines.push('Saved with Git Code Port');
  return lines.join('\n');
}

/** Optional header comment for the file itself (off by default). */
export function sourceHeader(langId, context = {}, capturedAt) {
  const lang = byId[langId];
  const url = redactSourceUrl(context.url);
  if (!lang || !lang.comment || !url) return '';
  const [pre, post] = lang.comment;
  const safe = (s) => String(s).replace(/\*\/|-->|\n/g, ' ');
  return `${pre} Source: ${safe(url)}${post}\n${pre} Captured: ${safe(capturedAt || '')}${post}\n\n`;
}
