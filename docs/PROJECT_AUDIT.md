# Project audit (start of Version 2)

Audit date: 2026-11-24. Baseline: `main` at `2c65e1a` (v0.1.0).

## Git state at the start

| Check | Result |
|---|---|
| `git status` | clean, nothing uncommitted |
| `git branch` | `main` only (remote: `origin/main`) |
| `git remote -v` | `origin https://github.com/ikaustav/git-code-port` |
| `git log` | `2c65e1a docs: add README…`, `0c5cdc8 feat: add Git Code Port extension…` |

V2 work happens on `release/v2`, so `main` stays at the reviewed v0.1.0 until the V2 branch is reviewed.

## Inventory

- **Manifest V3**, Chromium 116+, no build step, no runtime dependencies, about 67 KB of JavaScript.
- Permissions: `contextMenus`, `storage`, `activeTab`, `scripting`; host `https://api.github.com/*`. No content scripts, no `web_accessible_resources`, no `externally_connectable`.
- CSP: `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src https://api.github.com`.
- Components: service worker (menu, shortcut, popup message), capture module, review window, popup, options page, GitHub REST client, language detection, filename/folder suggestions, secret scanner, validation, storage.
- Tests: 14 unit tests (Node), 17 end-to-end checks (Playwright + Chromium, mocked GitHub API), `scripts/check.mjs` static checks. Playwright is not declared in `package.json` (it is expected to be installed globally).
- Docs: README only. No LICENSE, SECURITY.md, CHANGELOG or CI.

## What works (verified by the existing tests)

Selection capture with exact indentation, review and edit, language detection for 21 languages, filename and folder suggestions, create via Contents API, duplicate-content detection, conflict screen with save-as-new and two-step replace using the SHA, missing-branch errors, secret warnings, XSS-safe rendering, auth errors, settings connect and disconnect.

## Gaps against the V2 brief

| Area | State in v0.1.0 | V2 action |
|---|---|---|
| Content types | Code only; text falls back to `.txt` | Add categories (notes, commands, prompts, research, docs, resources, config, DSA, SQL) and Markdown output |
| Classification | Language only | Lightweight local classifier: category, folder, filename, tags |
| Side panel | None | Add a side panel workspace: Home, Explore, Capture, History, Repositories, Settings |
| History | Last 20 saves, success only | Local metadata index with states (captured, uploaded, failed, conflict), search and filters |
| Version management | Create, replace | Add file commit history, line diff, restore an earlier version |
| Tags | None | Tags in the index and the commit message |
| Duplicate detection | Same path + same content only | Also warn when identical content was saved before anywhere |
| Message validation | Sender check, loose payload | Central validator: sender, type allow-list, payload shape |
| Auth | User-supplied PAT, optional unencrypted persistence | Keep for beta, add expiry and token-type checks, document the GitHub App path as a public-release blocker |
| CI | None | Tests + static checks, CodeQL, Dependabot for Actions |

## Bugs and weaknesses found

1. **Large selections can fail silently-ish.** Captures up to 2M characters are written to `chrome.storage.session` (10 MB quota, UTF-16 cost). A very large selection could exceed the quota and only flag the toolbar icon with a generic error. Fix: reject selections over the 1 MB upload limit with a clear message, before storing.
2. **Source URL may leak secrets into commit history.** The full page URL (including query string and fragment, which can carry session or reset tokens) is written to the commit message by default. Fix: record only origin + path by default.
3. **Notes are not secret-scanned** before they go into the commit message. Fix: scan them too.
4. **Popup message payload is not schema-checked** (sender is). Fix: central validator.
5. **Playwright dependency is implicit.** Fix: document it; keep it out of the shipped package.

## Reuse decision

All v0.1.0 modules are kept. The review window remains the single place where writes happen; the new side panel reuses the same GitHub client, storage and processing modules. Nothing working is removed.
