# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 2.0.x | Yes |
| 0.1.x | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

1. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.
2. If that is unavailable, contact the maintainer [@ikaustav](https://github.com/ikaustav) through GitHub and ask for a private channel.

Include the browser and version, the extension version, steps to reproduce, and the impact. **Never include a real token**; use a revoked or fake one.

You can expect an acknowledgement within 7 days. Fixes are released as soon as practical, and reporters are credited unless they prefer otherwise.

## Scope

In scope: anything in this repository, for example a webpage reading the token, a page triggering a GitHub write without user confirmation, HTML/script injection into extension pages, writes to unexpected paths, or data kept longer than documented.

Out of scope: a compromised browser, operating system or GitHub account; social engineering; issues requiring the user to paste a malicious token or change the code.

## Security design in short

- No server, analytics, AI service or remote code. Network access only to `https://api.github.com`.
- Token in `chrome.storage.session` by default, sent only in the `Authorization` header.
- Captured content is treated as untrusted text: rendered with `textContent`/`value`, never executed; strict CSP.
- No GitHub write without explicit confirmation; overwrites need a diff and a second confirmation and send the current SHA.
- Messages to the service worker are validated (sender, origin, type, payload shape).

The full threat model, findings and remaining risks are in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). That audit was produced with AI assistance and **has not yet been reviewed by an independent human**.

## Known limitations

- Authentication uses personal access tokens. A GitHub App device-flow design exists but is not implemented.
- A token saved with *Remember* is stored unencrypted on disk.
- Secret detection is heuristic.
