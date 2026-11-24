# Architecture

Git Code Port is a Manifest V3 extension written as plain ES modules. There is no build step, no framework and no runtime dependency. GitHub is the source of truth for files and history; the extension keeps only settings, a short-lived capture buffer and a local index.

## Components

| Component | Files | Role |
|---|---|---|
| Service worker | `src/background/service-worker.js` | Context menus, keyboard command, validated messages from extension pages. Opens the review window. Never writes to GitHub. |
| Capture | `src/capture/capture.js` | Runs one argument-free function in the active tab via `chrome.scripting` to read the selection (all frames, then top frame). Enforces the 1 MB limit. Stores the capture in `storage.session` (expires after 6 h). |
| Classifier | `src/classifier/` | Category, language, format, folder, filename and tag suggestions. Pure functions, no network. |
| Processing | `src/processing/` | Language detection, filename/folder templates, metadata trailer, secret scanner. |
| Review window | `src/review/` | Edit → confirm → push. Duplicate check, conflict diff, two-step replace. The only place that creates or updates files. |
| GitHub client | `src/github/api.js` | REST calls with the token in the `Authorization` header, error mapping, response validation, file commit listing. |
| History | `src/history/` | Local index (`captureIndex`, max 500) with states and search; LCS line diff. |
| Side panel | `src/sidepanel/` | Workspace: Home, Explore, Capture, History (versions, compare, restore), Repos, Settings. |
| Security helpers | `src/security/` | Message validator, URL redaction, token assessment. |
| Options / popup | `src/options/`, `src/popup/` | Token connection page; toolbar popup. |

## Capture to commit

```
user action (menu / popup / shortcut / side-panel button)
  → service worker: validate, captureAndReview(tab, hints)
  → capture.js: read selection in the tab, size check, buffer in storage.session
  → review window: classify, user edits, secret scan, existence check on GitHub
  → confirm screen: exact bytes, path, commit message
  → api.putFile (with SHA when replacing) → validate response
  → history index: status uploaded / updated / failed / conflict
```

## Restore

Side panel → History → item → *Show versions* (`GET /repos/{o}/{r}/commits?path=&sha=`) → *Restore…* fetches the old content at that commit, shows the diff, requires a ticked confirmation, then writes it as a **new** commit with the current SHA.

## Storage

| Key | Area | Content |
|---|---|---|
| `githubToken` | session (also local with *Remember*) | GitHub token |
| `capture:*` | session | Pending capture, deleted after save or 6 h |
| `settings` | local | Preferences, folder templates, repo defaults, privacy toggles, theme |
| `repoCache` | local | Repository list from GitHub (names, default branch, push access) |
| `captureIndex` | local | Metadata of up to 500 captures; optional 500-character excerpts |

## Trust boundaries

1. **Web page → extension:** only the selected text and page title/URL, read on user action. Treated as untrusted: rendered via `textContent`/`value`, never executed.
2. **Extension pages → service worker:** messages validated by `src/security/messages.js`.
3. **Extension → GitHub:** HTTPS to `api.github.com` only; responses validated before use.

See [SECURITY_AUDIT.md](../SECURITY_AUDIT.md) for the threat model.

## Testing

- `scripts/check.mjs`: manifest, permissions, CSP, banned APIs (`innerHTML`, `eval`, `console.*`), secret patterns.
- `tests/unit.test.js`, `tests/v2.test.js`: Node test runner.
- `tests/e2e.js`: Playwright drives Chromium with the unpacked extension and a mocked GitHub API. The test copy adds `<all_urls>` so pages can be read without a real click; the shipped manifest does not.
