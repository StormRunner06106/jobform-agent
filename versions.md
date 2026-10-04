# Versions

Version logging has not started. No releases have been recorded.

Only an explicit user request starts or advances the release log. Builds and commits never change it.

First command: `node scripts/version.mjs start --message "First release"` records **0.0.1**.
Later command: `node scripts/version.mjs next --message "Describe the upgrade"` records the next version.
Check without changing anything: `node scripts/version.mjs status`.

Sequence: `0.0.1 ... 0.0.9 → 0.1.0 ... 0.1.9 → 0.2.0 ... 0.9.9 → 1.0.0`.
Patch and minor digits range from 0 to 9; the major number carries upward.

Before logging starts, package version `0.0.0` and Chrome manifest version `0.0.0.1` are development placeholders, not releases. Chrome disallows an all-zero manifest version. The setter updates both manifests and this log together.

<!-- release-history -->

No releases yet.
