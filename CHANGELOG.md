# Changelog

All notable changes. Dates are UTC. This project follows [Semantic Versioning](https://semver.org/).

## [2.0.0 beta] — 2026-11-24 (branch `release/v2`, not yet merged)

Ready for internal testing. Not yet for public release (see [SECURITY_AUDIT.md](SECURITY_AUDIT.md)).

### Added
- **Universal capture:** right-click submenu *Git Code Port* with auto-detect and explicit types (code, notes, commands, documentation, AI prompt, resource).
- **Local classifier:** categories code, DSA, commands, SQL, config, notes, docs, research, prompt, resource; folder, filename, format and tag suggestions. No network or AI service.
- **Formats:** source file, Markdown, Markdown with code block (collision-safe fence), plain text.
- **Side panel workspace:** Home, Explore, Capture, History, Repos, Settings.
- **History index** with states (captured, pending, uploaded, updated, restored, already on GitHub, failed, conflict), search and filters, details, *Continue review*.
- **Version management:** per-file commit list, compare with current, restore as a new commit with confirmation, line diff on the conflict screen.
- **Organization:** category folder templates, per-repository branch and base folder, tags, duplicate warning (SHA-256 of content).
- **Settings:** token type and expiry with warnings, privacy toggles, theme (system/light/dark), side-panel permission revoke.
- **Quality:** V2 unit tests, extended end-to-end tests, GitHub Actions CI, CodeQL, Dependabot.
- **Docs:** SECURITY_AUDIT.md, SECURITY.md, ARCHITECTURE.md, project audit, implementation plan, new screenshots.

### Security
- Service-worker message validator (sender id, extension origin, type allow-list, exact payload shape).
- Source URLs redacted to origin + path by default (query strings and fragments can hold tokens).
- Selections over 1 MB refused with a clear message instead of failing in storage.
- Notes included in the secret scan.
- GitHub write responses validated (commit SHA format, path) before success is recorded.
- Side-panel capture uses an *optional* host permission requested on click and revocable.

### Changed
- History moved from a simple list to the capture index; the old list is migrated automatically.
- Manifest version 2.0.0; adds the `sidePanel` permission and optional host permissions.

### Not done
- GitHub App / device-flow sign-in (design documented).
- Demo GIF, Firefox support, sync of history from GitHub.

## [0.1.0] — 2026-11-24 (`main`)

### Added
- MV3 extension: capture selection (menu, toolbar, Alt+Shift+G), review window, language detection, filename and folder suggestions, secret warnings, safe create/update via the GitHub Contents API, conflict handling, recent history, fine-grained token settings.
- Static checks, unit tests, Chromium end-to-end tests with a mocked GitHub API, README and screenshots.
