// Minimal GitHub REST client for the Contents API workflow.
// The token is only ever sent to https://api.github.com and is never logged.

import { utf8ToBase64, base64ToUtf8 } from '../utils/encoding.js';

export const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(kind, message, { status = 0, retryable = false, detail = '' } = {}) {
    super(message);
    this.kind = kind; // auth | permission | not_found | conflict | rate_limit | network | invalid | server
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export function isSha(v) {
  return typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
}

/** Only https://github.com/ links are ever shown to the user. */
export function safeGitHubUrl(v) {
  return typeof v === 'string' && /^https:\/\/github\.com\//.test(v) ? v : '';
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function toError(res, context) {
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const msg = body.message || res.statusText || 'Unknown error';
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const s = res.status;

  if (s === 401) return new GitHubError('auth', 'GitHub rejected the token. It may be expired or revoked. Reconnect in Settings.', { status: s, detail: msg });
  if ((s === 403 || s === 429) && (remaining === '0' || /rate limit/i.test(msg))) {
    const when = reset ? new Date(reset * 1000).toLocaleTimeString() : 'later';
    return new GitHubError('rate_limit', `GitHub rate limit reached. Try again after ${when}.`, { status: s, retryable: true, detail: msg });
  }
  if (s === 403) return new GitHubError('permission', `Permission denied${context ? ` (${context})` : ''}. Make sure the token has "Contents: Read and write" access to this repository.`, { status: s, detail: msg });
  if (s === 404) return new GitHubError('not_found', context ? `${context} not found, or the token cannot see it.` : 'Not found.', { status: s, detail: msg });
  if (s === 409) return new GitHubError('conflict', 'The file changed on GitHub while you were reviewing. Check it again before saving.', { status: s, detail: msg });
  if (s === 422) {
    if (/sha/i.test(msg)) return new GitHubError('conflict', 'A file already exists at this path, or it changed since it was checked.', { status: s, detail: msg });
    return new GitHubError('invalid', `GitHub rejected the request: ${msg}`, { status: s, detail: msg });
  }
  if (s >= 500) return new GitHubError('server', `GitHub had a temporary problem (${s}). Try again.`, { status: s, retryable: true, detail: msg });
  return new GitHubError('invalid', `GitHub error ${s}: ${msg}`, { status: s, detail: msg });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GitHubClient {
  constructor(token, { fetchImpl } = {}) {
    if (!token) throw new GitHubError('auth', 'Not connected to GitHub. Add a token in Settings.');
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  /** Low-level request. GETs are retried with backoff on network/5xx errors; writes are not. */
  async request(method, path, { body, context, allow404 = false } = {}) {
    const attempts = method === 'GET' ? 3 : 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep(400 * 2 ** (i - 1));
      let res;
      try {
        res = await this.fetch(`${API_BASE}${path}`, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': API_VERSION,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
      } catch {
        lastErr = new GitHubError('network', 'Could not reach GitHub. Check your connection and try again.', { retryable: true });
        continue;
      }
      if (allow404 && res.status === 404) return { status: 404, data: null, headers: res.headers };
      if (res.ok) {
        const data = res.status === 204 ? null : await res.json();
        return { status: res.status, data, headers: res.headers };
      }
      lastErr = await toError(res, context);
      if (!(lastErr.kind === 'server' && method === 'GET')) throw lastErr;
    }
    throw lastErr;
  }

  async getUser() {
    return (await this.request('GET', '/user', { context: 'Account' })).data;
  }

  /** The account plus token metadata from response headers (never the token itself). */
  async getUserAndTokenInfo() {
    const r = await this.request('GET', '/user', { context: 'Account' });
    return {
      user: r.data,
      headers: {
        scopes: r.headers.get('x-oauth-scopes'),
        expiration: r.headers.get('github-authentication-token-expiration'),
      },
    };
  }

  /** Repos the token can access and push to, most recently pushed first. */
  async listRepos({ maxPages = 5 } = {}) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data } = await this.request('GET', `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, { context: 'Repository list' });
      out.push(...data);
      if (data.length < 100) break;
    }
    return out
      .filter((r) => !r.permissions || r.permissions.push)
      .map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, archived: r.archived }))
      .filter((r) => !r.archived);
  }

  async listBranches(fullName, { maxPages = 3 } = {}) {
    const names = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data } = await this.request('GET', `/repos/${fullName}/branches?per_page=100&page=${page}`, { context: `Repository ${fullName}` });
      names.push(...data.map((b) => b.name));
      if (data.length < 100) break;
    }
    return names;
  }

  async branchExists(fullName, branch) {
    const r = await this.request('GET', `/repos/${fullName}/branches/${encodeURIComponent(branch)}`, { context: `Repository ${fullName}`, allow404: true });
    if (r.status !== 404) return true;
    // Distinguish "repo missing" from "branch missing".
    const repo = await this.request('GET', `/repos/${fullName}`, { allow404: true });
    if (repo.status === 404) throw new GitHubError('not_found', `Repository ${fullName} not found, or the token cannot see it.`, { status: 404 });
    return false;
  }

  /** @returns {null | { sha, content, htmlUrl, isFile }} */
  async getFile(fullName, path, branch) {
    const r = await this.request('GET', `/repos/${fullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, { context: `Path ${path}`, allow404: true });
    if (r.status === 404) return null;
    const d = r.data;
    if (Array.isArray(d) || d.type !== 'file') return { isFile: false, sha: null, content: null, htmlUrl: null };
    let content = null;
    if (d.encoding === 'base64' && typeof d.content === 'string' && d.content) {
      try { content = base64ToUtf8(d.content); } catch { content = null; }
    }
    return { isFile: true, sha: d.sha, content, htmlUrl: d.html_url, size: d.size };
  }

  /**
   * Create (no sha) or update (with sha). Never called without an explicit user decision.
   * The response is validated before it is reported as a success.
   */
  async putFile(fullName, path, { content, message, branch, sha }) {
    const body = { message, content: utf8ToBase64(content), branch };
    if (sha) body.sha = sha;
    const { data } = await this.request('PUT', `/repos/${fullName}/contents/${encodePath(path)}`, { body, context: `Path ${path}` });
    const commitSha = data && data.commit && data.commit.sha;
    const contentPath = data && data.content && data.content.path;
    if (!isSha(commitSha) || (contentPath !== undefined && contentPath !== path)) {
      throw new GitHubError('unexpected', 'GitHub answered, but not with the expected confirmation. Check the repository on GitHub before trying again.', { detail: 'Missing or mismatched commit data in the response.' });
    }
    return {
      htmlUrl: safeGitHubUrl(data.content && data.content.html_url),
      commitUrl: safeGitHubUrl(data.commit.html_url),
      commitSha,
      sha: data.content && data.content.sha,
    };
  }

  /** Commits that touched a file on a branch, newest first. */
  async listFileCommits(fullName, path, branch, { perPage = 20 } = {}) {
    const q = `path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${perPage}`;
    const { data } = await this.request('GET', `/repos/${fullName}/commits?${q}`, { context: `Repository ${fullName}` });
    if (!Array.isArray(data)) throw new GitHubError('unexpected', 'GitHub returned an unexpected commit list.');
    return data.filter((c) => c && isSha(c.sha)).map((c) => ({
      sha: c.sha,
      message: String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 200),
      date: (c.commit && c.commit.author && c.commit.author.date) || '',
      author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '',
      htmlUrl: safeGitHubUrl(c.html_url),
    }));
  }
}
