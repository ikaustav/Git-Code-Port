// Heuristic secret scanner. It WILL miss things and flag some false positives; the UI says so.

const PATTERNS = [
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_?secret_?access_?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Slack webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  { name: 'Stripe secret key', re: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI-style API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'Credentials in URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{3,}@[^\s/]+/i },
  {
    name: 'Hard-coded password or secret',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{6,})["']/i,
    // Skip obvious placeholders.
    ignore: /^(?:x+|\*+|\.{3,}|<[^>]+>|\$\{?\w+\}?|your[_-]?\w*|changeme|example\w*|placeholder|password|secret|test\w*|dummy\w*|redacted|null|none|undefined|process\.env.*|os\.environ.*)$/i,
  },
];

function mask(s) {
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;
}

/**
 * @returns {Array<{ type: string, line: number, preview: string }>}
 */
export function scanForSecrets(text) {
  const findings = [];
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const value = m[1] || m[0];
      if (p.ignore && p.ignore.test(value)) continue;
      findings.push({ type: p.name, line: i + 1, preview: mask(value) });
    }
  });
  // One finding per (type, line).
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.type}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
