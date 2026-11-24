// Lightweight, local content classification. No network, no AI service.
// Returns suggestions only; the review screen lets the user change every one of them.

import { detectLanguage, byId } from '../processing/languages.js';
import { platformFromUrl, titleWords, symbolFromCode } from '../processing/filename.js';
import { categoryById } from './categories.js';
import { sanitizeFilename } from '../utils/validation.js';

const DSA_PLATFORMS = new Set(['LeetCode', 'GeeksForGeeks', 'Codeforces', 'HackerRank', 'CodeChef', 'AtCoder', 'HackerEarth', 'InterviewBit', 'Codewars']);
const DOC_HOSTS = /(^|\.)(developer\.mozilla\.org|docs\.[\w-]+\.\w+|[\w-]+\.readthedocs\.io|learn\.microsoft\.com|devdocs\.io|cppreference\.com|docs\.python\.org|go\.dev|doc\.rust-lang\.org|kubernetes\.io|nodejs\.org)$/;
const RESEARCH_HOSTS = /(^|\.)(arxiv\.org|scholar\.google\.\w+|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|researchgate\.net|nature\.com|sciencedirect\.com|springer\.com|ieeexplore\.ieee\.org|acm\.org|semanticscholar\.org|biorxiv\.org)$/;
const AI_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com)$/;
const CLI = /^\s*(?:\$|#|>)?\s*(sudo|apt(?:-get)?|yum|dnf|pacman|brew|git|docker|docker-compose|kubectl|helm|npm|npx|yarn|pnpm|pip3?|python3? -m|cd|ls|cp|mv|rm|mkdir|chmod|chown|cat|grep|find|curl|wget|ssh|scp|tar|systemctl|journalctl|export|echo|source|ps|kill|top|df|du|nano|vim|touch|ln|unzip|zip|make|cargo|go|gh|az|aws|gcloud|terraform)\b/;

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function lines(text) { return String(text).split('\n').filter((l) => l.trim()); }

/** Which tool a block of commands is mostly about: Git, Docker, Kubernetes or Linux. */
export function commandTool(text) {
  const ls = lines(text);
  const count = (re) => ls.filter((l) => re.test(l)).length;
  const git = count(/^\s*\$?\s*git\b/);
  const docker = count(/^\s*\$?\s*(docker|docker-compose)\b/);
  const k8s = count(/^\s*\$?\s*(kubectl|helm)\b/);
  const best = Math.max(git, docker, k8s);
  if (!best || best < ls.length / 2) return 'Linux';
  if (best === git) return 'Git';
  if (best === docker) return 'Docker';
  return 'Kubernetes';
}

function looksLikeCommands(text, lang) {
  const ls = lines(text);
  if (!ls.length || ls.length > 80) return false;
  if (/^#!/.test(ls[0])) return false; // a script, not a list of commands
  const cli = ls.filter((l) => CLI.test(l) || /^\s*\$ /.test(l)).length;
  const comments = ls.filter((l) => /^\s*#/.test(l)).length;
  return cli >= 1 && (cli + comments) / ls.length >= 0.6 && (lang === 'bash' || lang === 'text' || lang === 'markdown' || cli / ls.length >= 0.6);
}

function looksLikePrompt(text) {
  const t = String(text).trim();
  if (t.length < 40) return false;
  if (/^(you are|act as|pretend you are|i want you to|imagine you are|your task is|system:|prompt:)/i.test(t)) return true;
  const imperatives = (t.match(/(^|\n)\s*(write|explain|summari[sz]e|generate|create|rewrite|translate|list|give me|help me|analy[sz]e)\b/gi) || []).length;
  return imperatives >= 2 && /\b(you|your)\b/i.test(t) && !/[;{}]\s*$/m.test(t);
}

function looksLikeResearch(text, host) {
  if (RESEARCH_HOSTS.test(host)) return true;
  const t = String(text);
  let score = 0;
  if (/\bet al\.?/.test(t)) score += 2;
  if (/\bdoi(?::|\.org\/)\s*10\.\d{4,}/i.test(t)) score += 3;
  if (/\[\d+(?:[,–-]\s*\d+)*\]/.test(t)) score += 1;
  if (/\b(abstract|methodology|hypothesis|findings|we propose|this paper|this study|results show)\b/i.test(t)) score += 2;
  if (/\(\w+(?: et al\.)?,? (19|20)\d{2}\)/.test(t)) score += 2;
  return score >= 3;
}

function looksLikeNotes(text) {
  const ls = lines(text);
  const bullets = ls.filter((l) => /^\s*([-*+•]|\d+[.)]|- \[[ x]\])\s+/i.test(l)).length;
  const headings = ls.filter((l) => /^#{1,6}\s/.test(l)).length;
  // Lists copied from web pages often lose their bullet characters: several short lines.
  const shortLines = ls.length >= 3 && ls.every((l) => l.trim().length <= 160);
  return bullets >= 2 || headings >= 1 || shortLines;
}

function isConfig(langId, text) {
  if (['json', 'yaml', 'dockerfile'].includes(langId)) return true;
  // INI / .properties / .env style
  const ls = lines(text);
  const kv = ls.filter((l) => /^\s*[\w.-]+\s*=\s*\S*/.test(l) || /^\s*\[[\w .-]+\]\s*$/.test(l) || /^\s*[#;]/.test(l)).length;
  return ls.length >= 2 && kv / ls.length >= 0.8 && ls.some((l) => /=/.test(l));
}

function isDsa(text, langId, platform) {
  if (DSA_PLATFORMS.has(platform)) return true;
  return /\bclass Solution\b/.test(text)
    || (/\b(cin|scanf)\b/.test(text) && /\bint main\b/.test(text) && /\b(t--|testcases?|while\s*\(\s*t--\s*\))/i.test(text))
    || /\b(def|int|void|long long)\s+solve\s*\(/.test(text);
}

/**
 * @param {string} text
 * @param {{ url?: string, title?: string, languageHint?: string }} context
 * @returns {{ category: string, confidence: 'high'|'medium'|'low', language: string, languageConfidence: string }}
 */
export function classify(text, context = {}) {
  const host = hostOf(context.url);
  const platform = platformFromUrl(context.url);
  const lang = detectLanguage(text, context);
  const t = String(text || '');
  const codeLike = lang.id !== 'text' && lang.id !== 'markdown';

  const result = (category, confidence) => ({ category, confidence, language: lang.id, languageConfidence: lang.confidence });

  if (!t.trim()) return result('notes', 'low');
  if (looksLikeCommands(t, lang.id)) return result('commands', 'high');
  if (lang.id === 'sql') return result('sql', lang.confidence);
  if (isConfig(lang.id, t)) return result('config', lang.id === 'text' ? 'medium' : lang.confidence);
  if (codeLike && lang.confidence !== 'low') {
    return isDsa(t, lang.id, platform) ? result('dsa', 'high') : result('code', lang.confidence);
  }
  if (looksLikePrompt(t)) return result('prompt', AI_HOSTS.test(host) ? 'high' : 'medium');
  if (looksLikeResearch(t, host)) return result('research', 'medium');
  if (DOC_HOSTS.test(host)) return result('docs', 'medium');
  if (codeLike) return result(isDsa(t, lang.id, platform) ? 'dsa' : 'code', 'low');
  if (looksLikeNotes(t)) return result('notes', 'medium');
  return result('resource', 'low');
}

/** Expands folder/filename placeholders that depend on content. */
export function expandCategoryTokens(template, text, context = {}) {
  const tool = commandTool(text);
  return String(template)
    .replace(/\{platform:([\w-]+)\}/gi, (_, fallback) => platformFromUrl(context.url) || fallback)
    .replace(/\{tool\}/gi, tool)
    .replace(/\{tool-lower\}/gi, tool.toLowerCase());
}

/** Suggested filename for non-source formats ('md', 'md-code', 'txt'). */
export function suggestTextFilename(category, text, format, context = {}) {
  const cat = categoryById[category] || categoryById.resource;
  const ext = format === 'txt' ? 'txt' : 'md';
  const words = titleWords(context.title).map((w) => w.toLowerCase());
  let base = '';
  if (category === 'commands') base = expandCategoryTokens(cat.base, text, context);
  else if (words.length && category !== 'prompt') base = words.join('-');
  if (!base && category === 'prompt') {
    const first = String(text).trim().split(/\s+/).slice(0, 5).join(' ');
    base = first.replace(/[^A-Za-z0-9 ]+/g, '').trim().toLowerCase().replace(/\s+/g, '-');
    base = base ? `prompt-${base}` : '';
  }
  if (!base) base = cat.base;
  return sanitizeFilename(`${base.slice(0, 80)}.${ext}`);
}

const KEYWORD_TAGS = [
  [/\brecurs(ion|ive)\b/i, 'recursion'], [/\bdynamic programming\b|\bdp\[/i, 'dynamic-programming'],
  [/\bgraph\b|\bbfs\b|\bdfs\b|adjacen/i, 'graphs'], [/\bbinary search\b|\blo\s*<=?\s*hi\b|\bleft\s*<=?\s*right\b/i, 'binary-search'],
  [/\blinked ?list\b|ListNode/i, 'linked-list'], [/\btree\b|TreeNode/i, 'trees'], [/\bheap\b|priority_queue|heapq/i, 'heaps'],
  [/\bsort(ed|ing)?\b/i, 'sorting'], [/\bhash ?map\b|unordered_map|HashMap|\bdict\(/i, 'hashing'],
  [/\bregex\b|RegExp|re\.(compile|match|search)/i, 'regex'], [/\bfetch\(|axios|requests\.(get|post)|curl /i, 'api'],
  [/\basync\b|\bawait\b|Promise/, 'async'], [/\bunit test|assert|pytest|describe\(|it\(/i, 'testing'],
];

/** Up to 6 lowercase tags: language, platform, category and keyword hits. */
export function suggestTags(text, category, languageId, context = {}) {
  const tags = [];
  const add = (t) => { const v = String(t).toLowerCase().replace(/[^a-z0-9+#-]+/g, '-').replace(/^-|-$/g, ''); if (v && !tags.includes(v)) tags.push(v); };
  if (languageId && languageId !== 'text' && byId[languageId]) add(byId[languageId].name === 'C++' ? 'cpp' : byId[languageId].name);
  const platform = platformFromUrl(context.url);
  if (platform) add(platform);
  if (category === 'commands') add(commandTool(text));
  if (category && category !== 'code') add(category);
  for (const [re, tag] of KEYWORD_TAGS) { if (re.test(text)) add(tag); if (tags.length >= 6) break; }
  return tags.slice(0, 6);
}

export function parseTags(input) {
  return [...new Set(String(input || '').split(/[,\s]+/).map((t) => t.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9+#._-]+/g, '-')).filter(Boolean))].slice(0, 12);
}

export { symbolFromCode };
