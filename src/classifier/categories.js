// Content categories. Every suggestion made from these can be changed by the user.
//
// format:
//   'source'   the text as-is, with the detected language's extension (e.g. .py)
//   'md'       the text as-is in a Markdown file (.md)
//   'md-code'  the text inside a fenced code block in a Markdown file (.md)
//   'txt'      the text as-is in a plain-text file (.txt)
// Only 'md-code' changes the bytes (it adds the fence lines), and the confirm screen shows it.

export const CATEGORIES = [
  {
    id: 'code', name: 'Code', folder: '{language}', format: 'source', base: 'snippet',
    description: 'Functions, classes, scripts and snippets in any programming language.',
  },
  {
    id: 'dsa', name: 'DSA / problem solving', folder: 'Coding/{platform:DSA}', format: 'source', base: 'solution',
    description: 'Solutions to LeetCode, Codeforces, GeeksforGeeks and similar problems.',
  },
  {
    id: 'commands', name: 'Commands', folder: 'Developer-Tools/{tool}', format: 'md-code', base: '{tool-lower}-commands',
    description: 'Linux, Git, Docker or other terminal commands and workflows.',
  },
  {
    id: 'sql', name: 'SQL', folder: 'Database/SQL', format: 'source', base: 'query',
    description: 'Queries, schemas and migrations.',
  },
  {
    id: 'config', name: 'Configuration', folder: 'Developer-Tools/Config', format: 'source', base: 'config',
    description: 'JSON, YAML, Dockerfiles, .ini and other configuration.',
  },
  {
    id: 'notes', name: 'Study notes', folder: 'Learning/Notes', format: 'md', base: 'notes',
    description: 'Your own notes, summaries, checklists and explanations.',
  },
  {
    id: 'docs', name: 'Documentation', folder: 'Learning/Docs', format: 'md', base: 'docs',
    description: 'Excerpts from official documentation, MDN, API references.',
  },
  {
    id: 'research', name: 'Research', folder: 'Research', format: 'md', base: 'research',
    description: 'Paper abstracts, research summaries and citations.',
  },
  {
    id: 'prompt', name: 'AI prompt', folder: 'AI/Prompts', format: 'md', base: 'prompt',
    description: 'Prompts and instructions you want to reuse with AI tools.',
  },
  {
    id: 'resource', name: 'Resource', folder: 'Resources/Articles', format: 'md', base: 'resource',
    description: 'Useful paragraphs, articles, links and reference material.',
  },
];

export const categoryById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const FORMATS = [
  { id: 'source', name: 'Source file (language extension)' },
  { id: 'md', name: 'Markdown (.md), content as-is' },
  { id: 'md-code', name: 'Markdown (.md), inside a code block' },
  { id: 'txt', name: 'Plain text (.txt)' },
];

/** Builds the file content for a format. Never changes the text except for md-code fences. */
export function formatContent(text, format, fenceLang = '') {
  const body = String(text);
  if (format !== 'md-code') return body;
  // Use a fence longer than any backtick run inside the text so it cannot be closed early.
  const longest = Math.max(2, ...(body.match(/`+/g) || []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${fenceLang}\n${body.replace(/\n$/, '')}\n${fence}\n`;
}
