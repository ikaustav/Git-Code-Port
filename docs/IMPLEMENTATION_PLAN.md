# Version 2 implementation plan

Architecture decision (from the product owner): **GitHub is the source of truth for saved files and their history.** The extension stores only the local metadata and preferences it needs (settings, a capture index, a short-lived capture buffer). No backend, no cloud storage, no analytics.

Release rule: **V2 is not "ready" until its authentication and security design has been reviewed by a human.** Code being finished is not enough.

| Milestone | Scope | Status |
|---|---|---|
| M1 Audit | PROJECT_AUDIT, this plan, SECURITY_AUDIT | Done |
| M2 Security foundation | Message validator, source URL redaction, size limits, notes secret scan, token type and expiry checks, auth review | Done (auth redesign documented, not implemented) |
| M3 Universal capture | Categories, local classifier, Markdown/text output, context submenu "Save as…" | Done |
| M4 Side panel | Home, Explore, Capture, History, Repositories, Settings | Done (side-panel capture on a real page tested manually only) |
| M5 Version management | File commit history, line diff on conflicts, restore earlier version with confirmation | Done |
| M6 Organization | Tags, local index with states, search and filters, duplicate warning | Done |
| M7 Quality | Unit + e2e tests for new features, CI, CodeQL, Dependabot | Done (CI results to be confirmed on GitHub) |
| M8 Docs and release prep | README, SECURITY.md, SECURITY_AUDIT.md, CHANGELOG.md, ARCHITECTURE.md | Done (demo GIF and human review outstanding) |

## Deliberately not done in this pass

- **GitHub App + OAuth device flow sign-in.** It needs a GitHub App registered by the maintainer (client ID, permissions, callback policy) and cannot be tested here without one. Shipping unverified auth code would be worse than the current, well-documented PAT flow. This is the main blocker for a public Web Store release. See `SECURITY_AUDIT.md`.
- Site-specific adapters (none needed so far; generic selection works).
- AI-assisted classification (not needed; would require explicit consent and data-transfer disclosure).
- Firefox port.
