# Test report

Git Code Port 2.0.0 · run on 2026-11-24 · Node.js 22 · Playwright 1.63.0 with Chromium

Every push and pull request runs these same checks in [GitHub Actions](https://github.com/ikaustav/Git-Code-Port/actions) (CI and CodeQL). You can reproduce them yourself with the commands at the end.

## Summary

| Suite | Result |
|---|---|
| Static checks (`npm run check`) | **6 / 6 passed** |
| Unit tests (`npm test`) | **24 / 24 passed** |
| End-to-end tests in Chromium (`npm run test:e2e`) | **27 / 27 passed** |
| Dependency audit (`npm audit`) | **0 vulnerabilities** |
| CodeQL security analysis (GitHub) | **Workflow passed** |

## Static checks

These checks validate the manifest, permissions and CSP, and ban unsafe APIs and committed secrets.

- ✅ manifest.json is valid JSON
- ✅ manifest references 10 files, permissions: contextMenus, storage, activeTab, scripting, sidePanel
- ✅ HTML pages reference only existing local files
- ✅ 28 JavaScript files pass node --check
- ✅ no eval, new Function, innerHTML, document.write or console logging in src/
- ✅ no secrets or credential files found

## Unit tests

These cover the classifier, filenames and folders, secret scanning, path validation, encoding, the GitHub client, message validation, URL redaction, token checks, the history index and the line diff.

- ✅ detects common languages from code alone
- ✅ uses page language hint
- ✅ language from filename extension
- ✅ filename suggestions
- ✅ folder template and commit message
- ✅ secret scanner flags real-looking secrets and skips placeholders
- ✅ path validation
- ✅ UTF-8 base64 round trip keeps unicode, tabs and newlines
- ✅ GitHub client maps errors and never retries writes
- ✅ GitHub client sends token only to api.github.com and encodes paths
- ✅ platform folders and problem titles
- ✅ commit metadata is configurable and single-line safe
- ✅ restricted pages are recognised
- ✅ sanitized filenames never contain path or reserved characters
- ✅ message validation: sender, type allow-list and payload shape
- ✅ source URLs are redacted to origin + path by default
- ✅ token assessment never needs the token value beyond its prefix
- ✅ classification covers code, DSA, commands, SQL, config, notes, docs, research, prompts and resources
- ✅ spec example filenames and folders
- ✅ tags are suggested and parsed safely
- ✅ formats keep content exactly, except md-code fences which are collision-safe
- ✅ index: upsert keeps one entry per id, search, duplicates, migration, excerpts
- ✅ line diff
- ✅ GitHub client validates write responses and lists file commits

## End-to-end tests

Playwright loads the real unpacked extension in Chromium. It selects text on test pages and clicks through the review window, popup, settings page and side panel. Every GitHub request goes to a local mock of the GitHub REST API, so no real account is touched. The screenshots in `docs/screenshots/` come from this run.

- ✅ context-menu capture opens review window with exact selection (indentation, tabs, unicode)
- ✅ suggests language, filename, folder, repo, branch, commit; hides read-only repos
- ✅ invalid path is blocked before any API write
- ✅ folder suggestions and step indicator are shown
- ✅ confirm screen then push creates the file with notes and source metadata in the commit
- ✅ identical file already on GitHub is reported without a duplicate commit
- ✅ existing file with different content: conflict screen, nothing overwritten, save as another file
- ✅ replace existing file needs a second explicit confirmation and sends the SHA
- ✅ source metadata can be left out of the commit
- ✅ empty selection does not open a review window
- ✅ popup capture button reports a clear error on a page it cannot read
- ✅ missing branch gives a clear error and no write
- ✅ secrets are flagged and push is blocked until acknowledged
- ✅ HTML/script in the selection is shown as text, never rendered
- ✅ revoked token shows an auth error with a Settings button
- ✅ settings page connects with a token, then disconnect clears it
- ✅ notes are classified, saved as Markdown in Learning/Notes, content unchanged
- ✅ "Save as commands" menu choice saves a fenced Markdown file under Developer-Tools/Git
- ✅ identical content saved before is flagged on the confirm screen
- ✅ selections over 1 MB are refused with a clear message, nothing stored
- ✅ service worker rejects malformed or unknown messages from extension pages
- ✅ side panel: navigation, home recent list, explore cards
- ✅ side panel: history search, filters, states and safe rendering
- ✅ side panel: version history, compare and restore with explicit confirmation
- ✅ side panel: repositories and settings (token type and expiry, privacy toggles)
- ✅ side panel quick capture is wired to the service worker and reports errors
- ✅ token never appears in page URLs

### Security-relevant cases covered

- HTML and `<script>` in a selection are shown as text in the review window and side panel, and never rendered.
- The token never appears in any page URL, and requests go only to `api.github.com`.
- Malformed or unknown messages to the service worker are rejected.
- An invalid path (`..`) is blocked before any write.
- An existing file is never overwritten without a diff and a second confirmation, and the replace sends the current SHA.
- Possible secrets block the push until the user acknowledges them, and the secret values are masked.
- Selections over 1 MB are refused, and nothing is stored.
- Query strings are removed from source URLs by default.

## Scope of automation

The browser cannot automate some steps, so the tests call the same code paths directly:
- the right-click and keyboard shortcut are driven through the same handler;
- the Chrome permission prompt for side-panel capture is skipped, because the test build has page access granted in advance;
- the GitHub API is mocked.

## Reproduce

```bash
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```
