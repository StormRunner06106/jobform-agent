# Job Form Agent

A Chrome side panel that uses a local Codex companion and selected Markdown/text knowledge to prepare job application answers. Development build; **release logging has not started**.

## Run locally (Windows)

1. Use Node.js 22 or newer and an installed Codex executable. There are no npm dependencies.
2. Run `node scripts/check.mjs`, `node --test test/*.test.mjs`, and `node scripts/build.mjs`.
3. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/extension`.
4. Register the companion once. The installer detects this checkout's extension ID from Chrome or reuses the saved registration:

   ```powershell
   ./scripts/install-host.ps1
   ```

5. Sign in once to the companion's isolated Codex profile:

   ```powershell
   ./scripts/login-codex.ps1 -CodexPath 'C:\path\to\codex.exe'
   ```

6. Open a job page and click the extension toolbar button. Enter the absolute knowledge-folder path. Codex is detected automatically: the companion checks the current user's VS Code and VS Code Insiders Codex extensions (newest first within each editor), then PATH for `codex.exe`. Grant site access for the page/frames, then click **Load knowledge**.
7. Select the application form if several regions exist, inspect the questions, and click **Run autofill**. Review every answer and submit yourself.

Use `Get-Command codex` to locate an executable already on PATH. Node is detected from PATH or the standard per-user installation folder. For a portable Node installation, pass `-NodePath 'C:\path\to\node.exe'` to the installer and invoke that executable in place of `node`. For a custom Chrome profile location, pass `-ExtensionId YOUR_EXTENSION_ID` once; the registration is saved.

After changes, rebuild and click **Reload** at `chrome://extensions`, then reopen the panel on your job page and click **Load knowledge** to reconnect. The initial **Agent not connected yet** badge is expected until Load is clicked. **Do not rerun installation or enter the extension ID on normal reloads.** Keep loading the same `dist/extension` folder. If you move the checkout or change the loaded extension, rerun the installer to update registration.

The companion is registered only for this extension ID under the current Windows user. Remove registration with `./scripts/install-host.ps1 -Uninstall`; local login/history files remain in `%LOCALAPPDATA%\jobform-agent`.

## What this build does

- Connects to Codex app-server, runs the health prompt, and reuses an application thread; matching saved sessions resume on Load.
- Reads a bounded, read-only Markdown/text knowledge index and retrieves relevant excerpts with source IDs.
- Scans visible native HTML forms, radio groups, checkboxes, selects, and accessible frames. Preserves existing answers and sends only pending questions to the agent.
- Detects Ashby's application tab layout without a `<form>` tag, including sibling demographic sections and Submit. Custom Ashby yes/no and checkbox groups are listed for manual review; the separate resume-autofill helper is excluded.
- Validates structured answers, fills supported fields, verifies retained values, and reports an activity log.
- Infers experience estimates (such as backend/frontend split) from related project evidence when an exact answer is absent. Chooses the closest supported option and shows an `Inferred:` explanation in the activity log. Exact personal, legal and sensitive facts require direct evidence.
- Makes at most three passes. Reports unresolved questions or scrolls to an identified Submit/Next button without clicking it.

**Current limits:** generic upload widgets remain a manual verification blocker, including previously uploaded attachments; custom widgets, closed shadow roots, arbitrary portal layouts, and site-specific validation need adapters. All inaccessible frames currently block Run, including unrelated frames. Page readiness uses two consistent snapshots; a particular site may need stronger readiness signals. Automatic reconnect, provider model selection, and cross-page application identification need further work; changed page paths require Load again. Live companion knowledge loading and health inference have passed; a complete real job application has not yet been verified.

The companion uses its own Codex home so it does not inherit the coding checkout's hooks/plugins/MCP configuration. Shell, browser, app, and other unnecessary tool features are disabled, and the agent receives extracted evidence rather than direct access to the knowledge folder. This profile needs its own login. Selected excerpts can be processed remotely by the provider, and Codex may retain conversation history locally. Never put private context or credentials in this repository.

## Version commands

`versions.md` is the human-readable log; `version-state.json` is its structured source. **Run the mutation commands only when the user explicitly requests version logging.**

| Command | Effect |
| --- | --- |
| `node scripts/version.mjs status` | Inspect without changing any file |
| `node scripts/version.mjs start --message "First release"` | First explicit log: 0.0.1; refuses a second start |
| `node scripts/version.mjs next --message "Describe the upgrade"` | Next explicit log; refuses before start |

Sequence: `0.0.1 … 0.0.9 → 0.1.0 … 0.9.9 → 1.0.0`. The setter synchronizes the log and manifests; build/tests/commits never increment versions. Rebuild after a version change. `0.0.0` (package) and `0.0.0.1` (Chrome) are unreleased development placeholders.

## Verification

### Live diagnostic logs

Run `node scripts/watch-logs.mjs`, then reload the extension, reopen its panel on a job page, and click **Load knowledge**. The terminal shows extension/panel events and companion/Codex events as they arrive. The receiver listens only on `127.0.0.1:43189` and accepts browser requests from the extension registered by the installer. It is independent of Native Messaging, so native-host startup failures can still be captured. Stop it with Ctrl+C.

The panel's **Diagnostic logs** section updates live and offers **Download logs**, including when the companion is unavailable. The last 300 events per extension component persist in Chrome storage across reloads. While the watcher runs, browser logs are also written to `%LOCALAPPDATA%\jobform-agent\logs\extension.jsonl`; the companion always writes `companion.jsonl` there. Each file rotates at approximately 1 MB with one previous file retained. Restart the watcher after changing the registered extension ID.

Logs contain timestamps, request IDs, phases, durations, counts and classified error codes. They exclude raw errors, knowledge paths/contents, page URLs, prompts, form answers and credentials. No runtime logs belong in Git. A successful CLI smoke test does not prove the user's Chrome connection works; use the live `panel` and `extension` events to diagnose that connection.

The tests exercise decimal version rollover, explicit startup, synchronized files, stale update protection, native framing, context boundaries, mocked Codex completion/resume, diagnostic persistence/filtering/rotation, local receiver access restrictions, and real Chrome scanner/UI behavior. The installed companion has also passed a live knowledge-load and Codex health check with diagnostic logging enabled. Browser tests use disposable profiles and synthetic answers. Set `CHROME_PATH` if Chrome is elsewhere. `dist/panel-preview.png` is generated by the panel browser test.

See [plan.md](plan.md) for the pipeline and [AGENTS.md](AGENTS.md) for development and commit rules.
