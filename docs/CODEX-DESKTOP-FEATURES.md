# Codex desktop features

Damndots owns the installation of the token-speed indicator and native orchestrator selector. Both are bundled with this repository; no files from a developer's manual patch workspace are required.

Start-Dots → native-dots → desktop-feature-manager builds a private application copy from the installed official Codex package. Package files in WindowsApps are never edited. The native launcher uses the managed copy only while Dots is running and the exact package version matches. Otherwise it resumes the original application. The launcher does not open Codex automatically.

The first supported adapter is **26.1021.3705.0**. A different version reports `unsupported-version`; update the adapter and verify it before enabling that version. Updates never reuse incompatible assets silently.

Managed files are under `.data/local-stack/native/desktop-features/`: `app/`, `active.json`, `status.json` and the running-service heartbeat. New builds parse every changed module as ESM and verify every ASAR entry/block plus executable/header hashes before activation. An app that is still running is not overwritten. Existing agent definitions are preserved; missing native role definitions are installed from the bundled templates.

The dashboard has separate **Token speed** and **Orchestrator** pages. Settings use the authenticated loopback PC bridge, even when the selected Dot data backend is remote. Display defaults and new-chat orchestration defaults apply on polling once Codex loads the patch. Explicit conversation choices take priority. Running agents are not reconfigured.

The TPS collector uses matched OpenCodex output-token/request-duration records and identifies native timing estimates when no exact provider match is available. This is a throughput indicator, not a guarantee of model-only decoding speed.

Settings and agent templates are not uploaded. To migrate a pre-existing private patch without losing unrelated edits, an agent can explicitly run `node scripts/desktop-feature-manager.mjs --adopt <private-app-directory>`. Adoption is one-time; the resulting application and future feature setup are managed by Damndots. Verify the installed version and actual launch path before retiring the old copy.
