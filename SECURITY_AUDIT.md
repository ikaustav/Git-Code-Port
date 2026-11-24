# Security audit: Git Code Port

| | |
|---|---|
| Scope | Everything in this repository on branch `release/v2` |
| Started | 2026-11-24, against `main` at `2c65e1a` (v0.1.0) |
| Method | Manual code review of every source file, threat modelling, automated checks (`npm run check`), unit and Chromium end-to-end tests including hostile inputs |
| Reviewer | AI-assisted review (Claude). **It has not been reviewed by an independent human security reviewer yet**, so treat it as a first pass, not a sign-off. |
| Guidance used | Chrome Extensions MV3 security guidance ("Stay secure", CSP, message passing, `activeTab`, `storage.session` access levels), Chrome Web Store program policies (limited use, minimum permissions), OWASP DOM-XSS prevention and threat-modelling cheat sheets, GitHub REST docs (Contents API, fine-grained PATs, token expiration headers, rate limits), the architectures of Bitwarden (secrets in privileged contexts only, strict message routing) and uBlock Origin (no remote code, minimal privileged surface) |

## 1. Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| GitHub token | `chrome.storage.session`, optionally `chrome.storage.local` | Write access to the user's repositories |
| Repository write access | Implied by the token | Malicious commits, overwritten files |
| Captured content | `chrome.storage.session` (capture buffer, 6 h), review window memory | May contain private code or secrets |
| Local capture index | `chrome.storage.local` | Paths, repos, source hosts, tags, optional short excerpts |
| Settings | `chrome.storage.local` | Default repo, folder templates |
| Source metadata | Commit messages on GitHub | Page titles and URLs become part of Git history |

## 2. Trust boundaries

1. **Web page ↔ extension.** The page is hostile. The extension reads selected text from it once, on a user action, through `chrome.scripting.executeScript` with a self-contained function. There is no long-lived content script and no `externally_connectable`, so pages cannot message the extension.
2. **Extension pages ↔ service worker.** Messages are accepted only from the extension's own pages, with an allow-listed type and a validated payload (`src/security/messages.js`).
3. **Extension ↔ GitHub.** HTTPS only, single host (`api.github.com`) enforced by `host_permissions` and the CSP `connect-src`. The token is only attached by `src/github/api.js`.

## 3. Threat model

Severity = impact if exploited. Likelihood = how plausible for this product. Status reflects `release/v2`.

| # | Threat | Severity | Likelihood | Mitigation | Verification | Status |
|---|---|---|---|---|---|---|
| T1 | Malicious page injects HTML/JS through captured text (XSS in review window or side panel) | High | Medium | Captured text only reaches the DOM through `value`/`textContent`; no `innerHTML`/`insertAdjacentHTML`/`document.write`; CSP `script-src 'self'` blocks inline script even if a sink slipped in | e2e: `<img onerror>`/`<script>` selection rendered as text in review **and** side panel history; `npm run check` bans the sinks | Mitigated |
| T2 | Page or other extension spoofs a message to trigger a capture or GitHub write | High | Low | No `externally_connectable`; no content scripts; service worker validates `sender.id`, sender URL is an extension page, type allow-list, payload shape; **no message can perform a GitHub write** (writes only happen in the review window after explicit clicks) | Unit tests of the validator (wrong sender, wrong type, extra fields, bad types); e2e sends a malformed message | Mitigated |
| T3 | Token theft via page context | High | Low | Token never enters page context (no content scripts, `storage.session` is `TRUSTED_CONTEXTS` only, `executeScript` function receives no arguments) | Code review; e2e checks token absent from page URLs | Mitigated |
| T4 | Token theft from disk (profile copied, malware) when "Remember" is ticked | High | Low–Medium | Off by default (session-only storage); UI warns that remembered tokens are not encrypted; fine-grained, repo-limited, short-expiry tokens recommended; expiry date shown | Manual; e2e checks token not persisted unless Remember is ticked | **Accepted for beta; residual risk** |
| T5 | Over-privileged credential (classic PAT with full `repo` scope) | High | Medium | Settings detect classic tokens (`ghp_` / `X-OAuth-Scopes`) and show a warning recommending a fine-grained token; docs explain minimal scopes | Unit test of token assessment | Mitigated (warning) |
| T6 | Credentials in URLs, logs or commits | High | Low | No token in URLs or query strings; no `console.*` in `src/` (enforced); secret scanner warns about credentials in captured code **and notes**; source URLs are redacted to origin + path by default | `npm run check`; unit tests for URL redaction and notes scanning | Mitigated |
| T7 | Accidental overwrite / data loss on GitHub | Medium | Medium | Existence check before create; replace and restore require a two-step confirmation and send the current SHA; GitHub rejects stale SHAs (409/422) and the UI re-checks instead of overwriting; writes are never auto-retried | e2e: conflict, two-step replace, restore with confirmation, SHA sent | Mitigated |
| T8 | Path traversal / writing to unexpected paths (`..`, `.git`, absolute, control characters) | Medium | Low | `validatePath`, `sanitizeFilename`, repo name regex, branch rules checked before any request; paths URL-encoded per segment | Unit tests | Mitigated |
| T9 | Open redirect / unsafe links from API data or history | Medium | Low | Links rendered only if they start with `https://github.com/`; `rel="noopener noreferrer"` | Unit + e2e | Mitigated |
| T10 | Sensitive content retained locally longer than needed | Medium | Medium | Capture buffer auto-expires (6 h) and is deleted after a save; index stores metadata, excerpts are optional, capped at 500 characters, and skipped when the secret scanner flags the content; one-click clear | Unit tests for index pruning and excerpt rules | Mitigated |
| T11 | Supply chain (dependencies, remote code) | High | Low | Zero runtime dependencies; no remote scripts (MV3 forbids, CSP `script-src 'self'`); CI pins actions to major versions with read-only permissions; Dependabot for Actions | `npm run check` checks CSP; CI config review | Mitigated |
| T12 | Denial of service via huge selection (storage quota, UI freeze) | Low | Medium | Selections over 1 MB are refused with a clear message before storage; diff falls back to a summary for very large files | Unit + e2e | Mitigated |
| T13 | Side panel capture abused to read arbitrary sites | Medium | Low | Side-panel capture uses the **optional** host permission `https://*/*` + `http://*/*`, requested only when the user first clicks a side-panel capture button (Chrome shows a prompt); not granted at install. Once granted it covers all sites, but the extension only reads the active tab's selection on a click. Revocable in side panel → Settings or in Chrome. Menu, popup and shortcut use `activeTab` only | e2e covers the wiring and error path (test build pre-grants hosts); the prompt, revoke and a real-page capture need a manual check | Partially mitigated (broad once granted; per-site scoping is future work) |
| T14 | Rate-limit / error messages leaking internals | Low | Low | Errors mapped to friendly text; raw GitHub message shown only in a collapsed "details" area, never the token | Unit tests of error mapping | Mitigated |
| T15 | Public-distribution auth model (users handling raw PATs) | High | Medium | Documented; GitHub App + device flow designed (section 5) | — | **Open: blocks public release** |

## 4. Findings and remediation

| ID | Finding | Severity | Remediation | Verification |
|---|---|---|---|---|
| F1 | Authentication relies on user-pasted personal access tokens | High (for public release) / Medium (personal use) | Kept for beta with hardening (F5, F6). GitHub App device-flow design written (section 5); implementation requires a registered app | Open, documented |
| F2 | "Remember" stores the token unencrypted in `chrome.storage.local` | Medium | Off by default, explicit warning; browser-only encryption would need a key stored next to the token, so it would add no real protection and is not pretended | Accepted, documented |
| F3 | Full source URL (query string, fragment) written into commit messages | Medium | Redacted to origin + path by default; full URL only if the user opts in | Unit + e2e |
| F4 | Very large selections could exceed `storage.session` quota and fail with a generic error | Low | Size check before storing, explicit message | Unit + e2e |
| F5 | No indication of token type or expiry | Low | Settings show token type, expiry (from `github-authentication-token-expiration`) and warn on classic tokens | Unit |
| F6 | Notes added to commit messages were not secret-scanned | Low | Notes included in the scan before confirm | Code review; e2e covers the content scan, the notes path has no dedicated test yet |
| F7 | Service worker message payloads only loosely checked | Low | Central validator with allow-list and shape checks | Unit |
| F8 | No CI, no automated static analysis on GitHub | Low | CI workflow (check + unit + e2e), CodeQL, Dependabot (Actions, npm) | Runs on GitHub after push |
| F9 | Playwright test dependency implicit | Info | Declared as `devDependencies` with a lockfile; not part of the packaged extension | `npm audit` in CI |

No critical findings. No hardcoded credentials found (`npm run check` scans every file; `git log -p` reviewed for the two existing commits).

## 5. Authentication review and recommended production design

**Current (v2 beta):** fine-grained PAT pasted by the user, verified with `GET /user`, stored in session storage by default.

| Property | Assessment |
|---|---|
| Least privilege | Good **if** the user follows the instructions (selected repos, Contents read/write). Classic tokens are now flagged. |
| Storage | Session storage is memory-only and inaccessible to content scripts. "Remember" is plaintext on disk. |
| Expiry / revocation | 401 handled everywhere with a reconnect prompt; expiry shown. No refresh mechanism (PATs have none). |
| Disconnect | Removes the token from both storage areas and clears the repo cache. Revocation on GitHub is linked and documented. |
| Suitability for a public extension | **Not ideal.** Users must create and handle a long-lived bearer credential. |

**Recommended for public release: GitHub App with the OAuth device flow, no backend.**

1. Register a GitHub App with only *Repository contents: read & write* and *Metadata: read*; enable device flow; installation limited to repositories the user selects.
2. Add `https://github.com/login/*` to `host_permissions` (needed for `POST /login/device/code` and `/login/oauth/access_token`; GitHub does not send CORS headers for these).
3. Flow: request a device code → show the code and open `https://github.com/login/device` → poll at the given interval → store the user-to-server token (8-hour expiry) in `storage.session`; persist the refresh token only if the user opts in.
4. A trusted backend is **not** required for the device flow (no client secret is used in the request). A backend would only be needed for the web-redirect OAuth flow or to keep a client secret, which this design avoids.
5. Benefits: short-lived tokens, per-repo installation managed in GitHub's UI, users never copy a raw credential, one-click revocation.

This needs the maintainer to register the app (client ID) and to test against real GitHub, so it is **not implemented in this pass**.

## 6. Remaining risks

- T4/F2 remembered-token storage on disk.
- T15/F1 PAT-based auth for public distribution.
- T13: once side-panel capture is allowed, the optional host permission covers all http(s) sites (used only on click). Per-site scoping is future work.
- Heuristic secret detection can miss secrets.
- The extension cannot protect against a compromised browser or OS.
- Tests use a mocked GitHub API; real-API behavior (especially rate-limit headers and organization token policies) still needs manual verification.

## 7. Release recommendation

**Ready for internal testing.** Not ready for a public release until F1/T15 is resolved and a human has reviewed this document and the authentication design.
