// Language catalogue + heuristic detection. Detection is a suggestion only; the user can override it.

// comment: [prefix, suffix] used for the optional source header.
export const LANGUAGES = [
  { id: 'python', name: 'Python', ext: 'py', comment: ['#', ''], aliases: ['py', 'python3'] },
  { id: 'javascript', name: 'JavaScript', ext: 'js', comment: ['//', ''], aliases: ['js', 'node', 'nodejs'] },
  { id: 'typescript', name: 'TypeScript', ext: 'ts', comment: ['//', ''], aliases: ['ts'] },
  { id: 'java', name: 'Java', ext: 'java', comment: ['//', ''], aliases: [] },
  { id: 'c', name: 'C', ext: 'c', comment: ['//', ''], aliases: [] },
  { id: 'cpp', name: 'C++', ext: 'cpp', comment: ['//', ''], aliases: ['c++', 'cplusplus'] },
  { id: 'csharp', name: 'C#', ext: 'cs', comment: ['//', ''], aliases: ['c#', 'cs', 'dotnet'] },
  { id: 'go', name: 'Go', ext: 'go', comment: ['//', ''], aliases: ['golang'] },
  { id: 'rust', name: 'Rust', ext: 'rs', comment: ['//', ''], aliases: ['rs'] },
  { id: 'kotlin', name: 'Kotlin', ext: 'kt', comment: ['//', ''], aliases: ['kt'] },
  { id: 'swift', name: 'Swift', ext: 'swift', comment: ['//', ''], aliases: [] },
  { id: 'php', name: 'PHP', ext: 'php', comment: ['//', ''], aliases: [] },
  { id: 'ruby', name: 'Ruby', ext: 'rb', comment: ['#', ''], aliases: ['rb'] },
  { id: 'bash', name: 'Shell', ext: 'sh', comment: ['#', ''], aliases: ['sh', 'shell', 'zsh', 'console', 'terminal'] },
  { id: 'sql', name: 'SQL', ext: 'sql', comment: ['--', ''], aliases: ['mysql', 'postgresql', 'postgres', 'sqlite'] },
  { id: 'html', name: 'HTML', ext: 'html', comment: ['<!--', ' -->'], aliases: ['htm', 'xml'] },
  { id: 'css', name: 'CSS', ext: 'css', comment: ['/*', ' */'], aliases: ['scss'] },
  { id: 'json', name: 'JSON', ext: 'json', comment: null, aliases: [] },
  { id: 'yaml', name: 'YAML', ext: 'yml', comment: ['#', ''], aliases: ['yml'] },
  { id: 'dockerfile', name: 'Dockerfile', ext: 'Dockerfile', comment: ['#', ''], aliases: ['docker'] },
  { id: 'markdown', name: 'Markdown', ext: 'md', comment: ['<!--', ' -->'], aliases: ['md'] },
  { id: 'text', name: 'Plain text', ext: 'txt', comment: null, aliases: ['plaintext', 'txt'] },
];

export const byId = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

export function languageFromExtension(filename) {
  const name = String(filename || '');
  if (/(^|\/)Dockerfile$/i.test(name)) return 'dockerfile';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!ext) return null;
  const extra = { jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', tsx: 'typescript', h: 'c', hpp: 'cpp', cc: 'cpp', yaml: 'yaml', zsh: 'bash', bash: 'bash', htm: 'html', scss: 'css' };
  if (extra[ext]) return extra[ext];
  const hit = LANGUAGES.find((l) => l.ext.toLowerCase() === ext);
  return hit ? hit.id : null;
}

// Each rule: [regex, weight]. Scores are summed; highest wins if above a threshold.
const RULES = {
  python: [[/^\s*def \w+\(.*\)\s*(->\s*[\w\[\], .]+)?:\s*$/m, 5], [/^\s*(from [\w.]+ )?import [\w., ]+$/m, 2], [/^\s*class \w+(\(.*\))?:\s*$/m, 4], [/\bself\b/, 2], [/\bprint\(/, 1], [/\belif\b/, 4], [/^\s*if __name__ == ['"]__main__['"]:/m, 6], [/\bNone\b|\bTrue\b|\bFalse\b/, 1], [/:\s*\n\s{2,}\S/, 1]],
  javascript: [[/\b(const|let|var) \w+ = /, 2], [/\bfunction\s*\w*\s*\(/, 2], [/=>\s*[{(]?/, 2], [/\bconsole\.log\(/, 4], [/\bdocument\.|\bwindow\./, 3], [/\brequire\(['"]/, 3], [/^\s*(import .* from ['"]|export (default |const |function ))/m, 3], [/===|!==/, 2], [/\bawait fetch\(/, 3]],
  typescript: [[/:\s*(string|number|boolean|void|any|unknown)\b/, 4], [/\binterface \w+\s*{/, 4], [/\btype \w+ = /, 3], [/<\w+>\(/, 1], [/\b(public|private|readonly) \w+:/, 3], [/\bas const\b/, 3]],
  java: [[/\bpublic (static )?(final )?class \w+/, 5], [/\bpublic static void main\(String\[\] \w+\)/, 8], [/\bSystem\.out\.print(ln)?\(/, 6], [/\b(private|public|protected) [\w<>\[\]]+ \w+\(/, 3], [/^\s*import java\./m, 6], [/\bnew \w+(<.*>)?\(/, 1], [/@Override/, 4]],
  c: [[/^\s*#include\s*<(stdio|stdlib|string|math)\.h>/m, 7], [/\bprintf\(/, 3], [/\bint main\(\s*(void|int argc)?/, 3], [/\bmalloc\(|\bfree\(/, 3], [/->\w+/, 1]],
  cpp: [[/^\s*#include\s*<(iostream|vector|string|bits\/stdc\+\+\.h|algorithm|map|unordered_map)>/m, 8], [/\bstd::/, 5], [/\bcout\s*<</, 5], [/\busing namespace std;/, 7], [/\bvector<\w+/, 3], [/\bclass \w+\s*{\s*\n?\s*public:/, 4], [/\bauto \w+ = /, 1]],
  csharp: [[/^\s*using System(\.\w+)*;/m, 7], [/\bConsole\.Write(Line)?\(/, 6], [/\bnamespace \w+/, 3], [/\bpublic (async )?(override )?(Task|void|string|int)\b.*\(/, 1], [/\b(get; set;|=> \w+;)/, 3], [/\bvar \w+ = new\b/, 2]],
  go: [[/^\s*package \w+\s*$/m, 5], [/\bfunc (\(\w+ \*?\w+\) )?\w+\(/, 5], [/\bfmt\.Print/, 5], [/:=/, 2], [/^\s*import \(\s*$/m, 4], [/\berr != nil\b/, 5]],
  rust: [[/\bfn \w+(<.*>)?\(/, 4], [/\blet mut\b/, 5], [/\bprintln!\(/, 6], [/\bimpl\b.*\{/, 3], [/\buse std::/, 6], [/->\s*(Result|Option|Self|\w+)/, 1], [/\b&mut\b|&str\b/, 3], [/\bpub (fn|struct|enum)\b/, 3]],
  kotlin: [[/\bfun \w+\(/, 5], [/\bval \w+(:\s*\w+)? = /, 3], [/\bprintln\(/, 1], [/\bdata class\b/, 6], [/\bcompanion object\b/, 6]],
  swift: [[/\bfunc \w+\(.*\)\s*(->\s*\w+)?\s*{/, 3], [/\bimport (UIKit|SwiftUI|Foundation)\b/, 8], [/\bguard let\b|\bif let\b/, 5], [/\bvar body: some View\b/, 8]],
  php: [[/<\?php/, 10], [/\$\w+\s*=/, 3], [/\becho\b/, 2], [/->\w+\(/, 1], [/\bfunction \w+\(\$/, 5]],
  ruby: [[/^\s*def \w+[!?]?(\(.*\))?\s*$/m, 3], [/^\s*end\s*$/m, 3], [/\bputs\b/, 4], [/\battr_(accessor|reader)\b/, 6], [/\.each do \|/, 6], [/^\s*require ['"]/m, 2]],
  bash: [[/^#!\/(usr\/)?bin\/(env )?(ba|z)?sh/m, 10], [/^\s*\$ \w+/m, 3], [/\b(sudo|apt(-get)?|brew|npm|pip3?|git|curl|wget|chmod|mkdir|cd|export|echo) /, 2], [/\bfi\b|\bdone\b|\besac\b/, 3], [/\$\{?\w+\}?/, 1], [/ \| (grep|awk|sed|xargs)/, 4]],
  sql: [[/\bSELECT\b[\s\S]+\bFROM\b/i, 6], [/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/i, 7], [/\bWHERE\b|\bJOIN\b|\bGROUP BY\b|\bORDER BY\b/i, 2]],
  html: [[/<!DOCTYPE html>/i, 10], [/<(html|head|body|div|span|p|a|ul|li|script|link|meta)(\s[^>]*)?>/i, 4], [/<\/\w+>/, 2]],
  css: [[/^\s*[.#]?[\w-]+(\s*[,>+~]\s*[.#]?[\w-]+)*\s*{\s*$/m, 3], [/^\s*[\w-]+\s*:\s*[^;]+;\s*$/m, 3], [/@media\b|@import\b|@keyframes\b/, 5], [/\b(margin|padding|color|display|font-size):/, 3]],
  json: [], // handled specially
  yaml: [[/^\s*[\w-]+:\s*(\S.*)?$/m, 1], [/^\s*-\s+[\w-]+:\s/m, 2], [/^---\s*$/m, 3], [/^(apiVersion|kind|services|version|on|jobs|steps):/m, 4]],
  dockerfile: [[/^\s*FROM\s+[\w./:-]+/m, 6], [/^\s*(RUN|COPY|WORKDIR|CMD|ENTRYPOINT|EXPOSE|ENV|ARG)\s/m, 4]],
  markdown: [[/^#{1,6} \w/m, 2], [/^\s*[-*] \[[ x]\]/m, 3], [/\[.+\]\(https?:\/\/.+\)/, 3], [/^```/m, 3]],
};

function looksLikeJson(text) {
  const t = text.trim();
  if (!/^[\[{]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

/** Hints from the page (URL, title, class names like "language-python"). */
function contextScores(context = {}) {
  const scores = {};
  const hay = `${context.languageHint || ''} ${context.title || ''} ${context.url || ''}`.toLowerCase();
  if (!hay.trim()) return scores;
  for (const lang of LANGUAGES) {
    const words = [lang.id, lang.name.toLowerCase(), ...lang.aliases];
    for (const w of words) {
      if (w.length < 2) continue;
      const esc = w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9+#])${esc}([^a-z0-9+#]|$)`).test(hay)) {
        scores[lang.id] = (scores[lang.id] || 0) + (context.languageHint && context.languageHint.toLowerCase().includes(w) ? 8 : 2);
        break;
      }
    }
  }
  return scores;
}

/**
 * @returns {{ id: string, confidence: 'high'|'medium'|'low' }}
 */
export function detectLanguage(code, context = {}) {
  const text = String(code || '');
  if (!text.trim()) return { id: 'text', confidence: 'low' };
  if (looksLikeJson(text)) return { id: 'json', confidence: 'high' };

  const scores = contextScores(context);
  for (const [id, rules] of Object.entries(RULES)) {
    for (const [re, w] of rules) if (re.test(text)) scores[id] = (scores[id] || 0) + w;
  }
  // Disambiguation nudges.
  if (scores.typescript && scores.javascript) scores.typescript += 2;
  if (scores.cpp && scores.c) scores.cpp += 2;
  if (scores.kotlin && scores.java && !/;\s*$/m.test(text)) scores.kotlin += 3;
  if (scores.yaml && Object.keys(scores).length > 1) scores.yaml -= 2;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) return { id: 'text', confidence: 'low' };
  const [best, top] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  const confidence = top >= 8 && top - second >= 4 ? 'high' : top >= 5 ? 'medium' : 'low';
  return { id: best, confidence };
}
