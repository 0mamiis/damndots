# Codex composer predictions

**Composer settings** controls optional next-message suggestions inside the Codex chat input on the PC. It does not create messages in a Dot. Suggestions are generated from the current conversation using the selected model, may use its quota, and are not sent until you edit or send the draft. Press Tab to accept a suggestion as a draft. New installations keep this feature off until the owner enables it.

The model list comes from enabled models in the PC's OpenCodex installation. The thinking level and optional Fast setting apply only to suggestions. The conversation's own model settings are not changed.

## Agent-assisted setup

Ask your coding agent to set this up on the PC that runs Codex and OpenCodex. It should first finish the regular Dots native setup, then:

1. Create or use a **private staged copy** of a compatible Codex app outside `WindowsApps`. The repository does not contain the Codex application. Close the copy before modifying it and keep a backup.
2. Run `node scripts/patch-composer-predictions.cjs <private-staged-app-copy>` against that copy. The patch checks its expected code anchors, JavaScript syntax and executable integrity before writing. If the version is incompatible, keep the original copy and stop; the script must not be run against the installed WindowsApps package.
3. Install the settings bridge with `scripts/install-codex-local-tools-bridge.ps1 -LocalOnly -ComposerAppRoot <private-app-copy>` when the backend runs on this PC. For a remote backend, use `-SshHost <your-ssh-alias>` instead of `-LocalOnly` and follow [the bridge instructions](DOT-CODEX-CHAT-MANAGEMENT.md) to place the token privately on the backend. Restart an already-running bridge after updating its files.
4. Start Dots and the patched private copy through your existing compatible launcher, then enable predictions in **Composer settings**. The original shortcut and installed application are not changed by the patch script. A launcher that starts the private copy with the Dots gateway environment is required; ordinary Dots setup does not create one.

The patch was tested with an existing private Windows Codex `26.1021.3705.0` copy. It depends on internal app code and can stop working after a Codex update. Other app versions and fresh-copy launch arrangements have not been verified. The panel reports whether the patch and bridge are connected; a saved setting alone does not prove a suggestion has appeared in the app.

The bridge holds a local authentication token and, for remote backends, uses an SSH reverse tunnel bound to loopback. Keep its token private. No credentials, app binaries or chat history are included in the repository.
