# Job Form Agent — Design Plan

Status: proposal for review; no application code is authorized yet.

Repository: [StormRunner06106/jobform-agent](https://github.com/StormRunner06106/jobform-agent).
SSH remote: `git@github.com:StormRunner06106/jobform-agent.git`.
Alex's application-profile link: [AlexanderHerlan](https://github.com/AlexanderHerlan), separate from the development repository owner.

## Intended experience

Alex installs the Chrome extension, a small local companion, and either Claude Code CLI or Codex CLI. In the extension, Alex selects the provider, enters the absolute path to a folder containing personal context and projects, and clicks **Load**. The companion reads the selected material and asks the agent to build an evidence-based profile. The extension shows **Connected** only after that operation succeeds.

On a job application page, Alex clicks **Run**. The extension identifies fields, asks the agent for answers grounded in Alex's context, fills supported fields, and reports what needs attention. Alex reviews and submits the application manually.

“Open projects” means discover and read relevant files under the selected folder. It does not mean opening an editor, running project code, installing dependencies, or starting project services.

## How it can work: three solutions

The browser-to-computer connection and the form-filling method are separate design choices. The first two solutions can share the same form-filling engine; the third changes how the agent controls the browser.

| Solution | Mechanism | Advantages | Costs and limits | Recommendation |
| --- | --- | --- | --- | --- |
| A. Native Messaging companion | Extension exchanges structured messages with a registered local program; that program reads context and launches the selected CLI. A content script fills the page. | Fits a Chrome extension, uses the existing logged-in tab, no listening network port. | Requires a companion installer and OS registration; extension ID must match the host registration. | Preferred MVP and distribution architecture. |
| B. Localhost companion service | Extension sends authenticated requests to a service bound to loopback; the service manages the CLI and context. Same content-script filling. | Convenient development, independent process lifetime, straightforward progress streaming. | Service startup, pairing, port conflicts, origin validation, and Chrome permission behavior must be handled. | Alternative if a persistent desktop service becomes useful. |
| C. Agent browser tools | Companion exposes a small set of browser actions to the CLI through a tool protocol such as MCP, allowing repeated inspect/fill/check steps. | Agent can adapt its next action after seeing a changed page. | More latency and tool calls; needs strict action limits and session routing. An independently automated browser may not share Alex's current login. | Later option for difficult forms; prototype compatibility first. |

For B, bind only to loopback, validate Host and Origin, require a per-install secret and session authorization, and authenticate WebSocket connections if used. CORS alone is insufficient. For C, prefer tools routed into this extension's selected tab over a second browser. Expose bounded field operations, never arbitrary page JavaScript or shell execution.

Chrome provides Native Messaging for communicating with a registered local application. Content scripts route native requests through the extension, and interact with the page DOM. These are the foundations for A. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Recommended design

Use a Manifest V3 extension with a side panel, a background service worker, and an on-demand content script. Use a local companion with interchangeable Claude and Codex adapters. Proposed implementation language is TypeScript for shared message definitions and the companion; packaging the companion for Windows is an early feasibility task.

Flow: **Side panel → extension service worker → native companion → context reader / CLI adapter → selected agent**. Separately, the service worker exchanges field snapshots and approved fill operations with the active page's content script.

The agent decides which facts answer which questions. The extension performs a fixed set of field operations and verifies the resulting values. Model responses are data, never executable code. Start with one structured proposal per page, followed by a bounded repair pass if necessary.

Use the side panel for folder/provider settings, Load, connection status, Run, Stop, progress, and field results. A side panel can stay beside the application page. [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

## Load: precise connection behavior

1. Alex selects Claude or Codex and enters a context folder. The UI explains that selected excerpts will be processed by that provider; running a CLI locally does not itself mean model inference is offline.
2. The service worker connects to the companion. Verify protocol compatibility and extension identity.
3. The companion resolves the folder to a canonical path, checks readability, and records the allowed root. Handle spaces and Unicode. Reject traversal and links or Windows junctions escaping that root.
4. Discover candidate documents and project summaries with explicit file-count, depth, byte, and token limits. Show included/skipped counts and reasons. Prefer profile/resume text and project README files; avoid blindly ingesting complete repositories.
5. Extract supported text into an isolated working area. Preserve relative source names and fingerprints. Do not load repository hooks, skills, instruction files, or project configuration into the runtime agent automatically.
6. Detect the selected CLI executable and version. Probe supported structured-output capabilities and run a small real request using its existing authentication. Installation alone must not produce a successful connection status.
7. Ask the agent to normalize the selected evidence into profile facts and project summaries, each with source references and unresolved conflicts. Validate the result locally.
8. Return a context session ID, context fingerprint, provider/version, included-file count, warnings, and completion time. Display **Connected — context loaded** and enable Run.

Suggested states: **Disconnected → Connecting → Reading context → Checking agent → Connected**. Failures distinguish missing companion, invalid folder, unreadable documents, missing CLI, authentication required, provider unavailable, unsupported CLI version, and invalid response. An empty usable context is not Connected.

Connected means the last Load succeeded and its session remains usable. Show its time, monitor companion disconnects, and recheck session/provider availability on Run. If the context changed, mark it stale and require a reload instead of using old evidence silently.

## Reading Alex's context

Existing folder layouts should work without mandatory restructuring. Recommended optional contents are a canonical profile, resume, work history, project summaries, and explicit application preferences. Markdown and plain text are the initial supported formats; PDF and DOCX extraction follow as separately tested capabilities. Scanned PDFs require OCR and should initially appear as unsupported.

Extract contact details, education, employment dates, skills, portfolio links, project contributions, and preferences only when supported by the files. Use the supplied GitHub profile as a confirmed link, not as evidence of employment or project ownership. Do not fetch all public repositories automatically.

Prefer explicit canonical profile facts over narrative project text. Flag conflicting dates or claims. Missing answers remain unknown. Reading source code can help explain a project but cannot establish Alex's authorship, years of experience, or business impact by itself.

The companion owns file filtering and retrieval. Give the agent only selected excerpts or a read-only context tool limited to this root. Running a CLI with a working directory or a read-only flag alone is not a guarantee that it cannot read elsewhere. Validate actual provider restrictions; otherwise use a sanitized snapshot with general filesystem and shell tools disabled. Keep personal context and caches outside the extension repository.

## Run: how fields actually get filled

1. Bind the run to a context session, tab, document, and origin. Detect unsupported browser pages or missing site access before starting.
2. The content script collects visible, enabled fields: label, accessible name, type, choices, required state, constraints, existing value, section heading, and a generated field ID. Include relevant job title and description text within size limits; exclude scripts, hidden inputs, passwords, and unrelated page content.
3. Send that snapshot and relevant profile evidence to the CLI. Request a structured proposal containing field ID, typed value, supporting source references, and a disposition: fill, review, or skip. Explanations should be short evidence summaries.
4. Validate field IDs, value types, option membership, length constraints, source references, and whether the document still matches. Reject arbitrary selectors, scripts, unsupported operations, and unknown fields from the model.
5. Automatically fill empty ordinary fields with supported answers. Preserve existing values by default. Unknown answers, conflicting evidence, sensitive declarations, and drafted narrative answers appear for review. Work authorization, sponsorship, salary expectations, and demographic answers require explicit source facts or a user choice; do not infer them.
6. Apply values through tested DOM operations and appropriate input/change events. Read values back after the site has reacted, checking visible validation errors. Treat framework-controlled inputs, custom dropdowns, dates, and repeated employment sections as adapter work rather than assuming every DOM write will stick.
7. Report per-field results: filled, preserved, needs review, unsupported, or failed. Permit one bounded rescan/repair for ordinary changed fields; stop if the document or target is ambiguous.
8. End with a review summary. Alex handles file uploads, CAPTCHA, consent/attestation checkboxes, Next, and final Submit in the MVP. On the next page, Alex clicks Run again.

For example, a Name field can be filled from the canonical profile, and a GitHub field can use the confirmed profile URL. “Describe a relevant project” can receive a draft with its source for review. A sponsorship question with no explicit answer stays unanswered.

The content script shares the page DOM, so values written into a form become available to that website even before Submit. Send only the selected field answers into the page. Supported frame and shadow-DOM behavior must be tested; cross-origin frames may need separate site permission, and closed shadow roots remain unsupported initially. [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## CLI integration contract

Both adapters expose the same conceptual operations: detect, check readiness, extract context, propose answers, and cancel. Normalize provider output into one application format. Resolve a trusted executable path and launch with argument arrays; send prompt content through standard input when supported. Never concatenate page text or user paths into shell commands.

Codex supports noninteractive `codex exec`, JSONL event output with `--json`, and final structured output with `--output-schema`. Its adapter must distinguish progress events from the final answer and validate the final payload. Existing saved CLI authentication can be reused. [Codex noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

Claude supports noninteractive `claude -p`, JSON or streaming output, and `--json-schema`. Its adapter must extract the structured payload from the provider envelope. Isolate startup configuration: Claude's documentation notes that ordinary print-mode sessions can execute project hooks and connect project MCP servers. Do not assume `--allowedTools` alone removes other tools. Bare mode has different authentication behavior, so select and test an isolation strategy compatible with the user's login. [Claude programmatic usage](https://code.claude.com/docs/en/headless).

Use only necessary read capabilities, deny writes and general shell actions, and never default to bypassing permissions. Pin and record tested CLI versions. If a capability cannot be enforced, mark that adapter unsupported rather than silently weakening the contract. Authentication recovery happens through the provider's normal local login flow; credentials never enter Chrome storage.

Run one request at a time initially. Set explicit time and output limits, cap repair attempts, surface rate-limit and authentication failures, and terminate the child process tree on Stop. Do not retry after any page-changing action without checking current page state.

## Messages, persistence, and permissions

Define versioned operations for load context, get status, propose answers, cancel, and disconnect. Every request has an ID; every run has a context fingerprint and document binding. Progress events contain stage and counts. Completion contains validated results; failures contain a stable error code and a readable remedy.

Use a long-lived native connection for progress. The companion packages provider output into bounded messages, reserving its stdout for the native protocol and sending diagnostics elsewhere. Chrome limits host-to-extension messages to 1 MB, so send summaries or chunks. On Windows, installation registers the host manifest for the user and allows the extension's exact ID. [Native Messaging protocol and registration](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Do not depend on a popup or in-memory service-worker state for a long operation. Keep run ownership in the companion and minimal recovery metadata in extension session storage. A lost connection invalidates Connected; cancel outstanding work where possible and discard late results. Require an explicit resume/reload after restart. Chrome service workers can terminate, and native connections have specific lifecycle behavior. [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Initial permissions: `nativeMessaging`, `storage`, `scripting`, `activeTab`, and `sidePanel`. Start from an explicit toolbar invocation for page access. Request optional host access only when a supported workflow needs it; do not assume a button inside an already-open side panel automatically grants new active-tab access. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

Persist settings locally, excluding credentials and raw context from sync storage. Keep profile/session data in memory initially; make any later disk cache explicit and clearable. Redact logs. Treat job pages and source documents as untrusted evidence, never instructions to expand filesystem access, change permissions, execute commands, or publish data.

## Delivery stages and acceptance criteria

| Stage | Deliverable after implementation is requested | Acceptance criteria |
| --- | --- | --- |
| 1. Connection prototype | Windows companion registration, Load/status UI, one selected CLI adapter | A folder containing spaces loads; missing host, missing CLI, expired login, and invalid folder return distinct failures; Connected follows a real validated request. |
| 2. Context extraction | Bounded discovery, provenance, sanitized runtime context | No out-of-root reads or project hooks; missing/conflicting facts remain unresolved; context change invalidates the session. |
| 3. First form workflow | Snapshot, structured proposal, fill and verification | Local fixture covers text, textarea, select, radios, checkboxes, and controlled inputs; existing values survive; unknown answers stay blank; Submit is never activated. |
| 4. Reliability and second provider | Common adapter contract, Stop, reconnect, permission handling | Both installed providers pass equivalent contract tests; malformed output, timeout, stale document, malicious page instructions, and disconnect cause no unintended writes. |
| 5. Site support and packaging | Windows installer and one chosen real application-site adapter | Manual check on an actual selected site stops before submission; uninstall removes companion registration; setup works without a development terminal. |

Use synthetic profiles for automated tests. Verify failure behavior and observable page outcomes rather than tests that merely repeat implementation details. Add site-specific support incrementally; do not promise universal ATS coverage. Multi-page automation, automatic resume upload, PDF/DOCX/OCR, macOS/Linux packaging, and agent browser tools are later stages.

## Defaults and remaining decisions

Proposed defaults: solution A, Windows first, both CLI providers through one contract, a side panel, sourced facts filled automatically, narrative answers reviewed, and manual submission. No cloud backend of our own is required; the chosen provider may still process prompts remotely.

Before implementation, choose the first target job site and first CLI to validate, and inspect a representative context folder's file formats. The GitHub destination is confirmed above. These remaining product decisions do not block reviewing this plan.

This planning task creates `plan.md`, `AGENTS.md`, and `.gitignore`, with an initial commit and push to the confirmed repository. It does not install software, run Alex's context, implement the extension, or create a GitHub repository. Git commit/push behavior for development agents is defined in `AGENTS.md` and is separate from the runtime form-filling agent.
