// Path and input validation for GitHub destinations.

const MAX_CONTENT_BYTES = 1024 * 1024; // Contents API create/update practical limit (1 MB).

// Characters that cause trouble on common filesystems or in Git.
const BAD_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|]/;

export function sanitizeFilename(name) {
  return String(name)
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-_]+/, '')
    .slice(0, 120);
}

export function joinPath(folder, filename) {
  const f = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
  return f ? `${f}/${filename}` : filename;
}

/** Returns a list of human-readable problems with a repository file path. Empty list = OK. */
export function validatePath(path) {
  const problems = [];
  const p = String(path || '');
  if (!p.trim()) return ['Path is empty.'];
  if (p.startsWith('/')) problems.push('Path must not start with "/".');
  if (p.endsWith('/')) problems.push('Path must end with a filename, not "/".');
  if (p.length > 400) problems.push('Path is too long.');
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '' && !p.startsWith('/') && !p.endsWith('/')) problems.push('Path contains an empty folder ("//").');
    if (seg === '.' || seg === '..') problems.push('Path must not contain "." or ".." segments.');
    if (seg.toLowerCase() === '.git') problems.push('Path must not write inside ".git".');
    if (BAD_CHARS.test(seg)) problems.push(`"${seg}" contains characters that are not allowed (\\ : * ? " < > | or control characters).`);
    if (seg !== seg.trim()) problems.push(`"${seg}" has leading or trailing spaces.`);
  }
  return [...new Set(problems)];
}

export function validateBranch(branch) {
  const b = String(branch || '').trim();
  if (!b) return ['Branch is empty.'];
  // Subset of git check-ref-format rules.
  if (/(^\/|\/$|\.\.|\/\/|@\{|[\u0000- ~^:?*\[\\\u007f]|\.lock$|^\.|\.$)/.test(b)) {
    return ['Branch name is not valid.'];
  }
  return [];
}

export function validateContent(text) {
  const problems = [];
  if (!String(text).trim()) problems.push('There is no code to save. Select some text first.');
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_CONTENT_BYTES) problems.push(`Content is ${(bytes / 1024).toFixed(0)} KB; the limit is 1024 KB.`);
  return problems;
}

/** Suggest "name-2.ext", "name-3.ext", ... for "Save as another file". */
export function nextAvailableName(path, attempt = 2) {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  const stripped = base.replace(/-\d+$/, '');
  return `${dir}${stripped}-${attempt}${ext}`;
}
