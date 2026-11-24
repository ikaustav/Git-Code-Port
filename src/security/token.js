// Describes a GitHub token without ever exposing its value.

const KINDS = [
  [/^github_pat_/, 'fine-grained', 'Fine-grained personal access token'],
  [/^ghp_/, 'classic', 'Classic personal access token'],
  [/^gho_/, 'oauth', 'OAuth app token'],
  [/^ghu_/, 'app-user', 'GitHub App user token'],
];

export function isPlausibleToken(token) {
  return typeof token === 'string' && /^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,250}$/.test(token);
}

/**
 * @param {string} token
 * @param {{ scopes?: string|null, expiration?: string|null }} headers  values of X-OAuth-Scopes and
 *        GitHub-Authentication-Token-Expiration from a /user response
 * @returns {{ kind: string, label: string, expiresAt: string, warnings: string[] }}
 */
export function assessToken(token, headers = {}, now = new Date()) {
  const hit = KINDS.find(([re]) => re.test(token || '')) || [null, 'unknown', 'Unknown token type'];
  const warnings = [];
  const kind = hit[1];
  if (kind === 'classic') {
    warnings.push('This is a classic token. It can usually reach every repository you can. A fine-grained token limited to selected repositories with "Contents: Read and write" is safer.');
    if (/\brepo\b/.test(headers.scopes || '')) warnings.push('It has the broad "repo" scope.');
  }
  let expiresAt = '';
  if (headers.expiration) {
    const d = new Date(String(headers.expiration).replace(' UTC', 'Z').replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) {
      expiresAt = d.toISOString();
      const days = (d - now) / 86400000;
      if (days < 0) warnings.push('This token has expired.');
      else if (days < 7) warnings.push(`This token expires in ${Math.max(1, Math.ceil(days))} day(s).`);
    }
  } else if (kind === 'fine-grained' || kind === 'classic') {
    warnings.push('This token has no expiration date. Consider a short expiry.');
  }
  return { kind, label: hit[2], expiresAt, warnings };
}
