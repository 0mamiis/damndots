# Dots with the main Codex app

## Usage and effects

`Start-Dots.cmd` starts only the backend, dashboard, worker and gateway services. It never opens a Codex window. While the services are running, use the **original Codex shortcut** you already have. The first time the integration is active, close an open Codex window once and reopen it.

The Windows MSIX package is launched with four process environment settings: `CODEX_API_BASE_URL`, `CODEX_CLI_PATH`, `CODEX_APP_SERVER_FORCE_CLI` and `NODE_EXTRA_CA_CERTS`. `CODEX_HOME` is not changed. The main `auth.json` and `config.toml`, shortcuts and the WindowsApps application files are not rewritten.

The gateway creates a private local CA for HTTPS. The native launcher adds this CA to the trusted root store of **the current Windows user only**. The system-wide certificate store is not modified. The private CA key and the gateway credentials stay under `.data/local-stack/native`, which is excluded from source distributions.

## How requests are routed

`scripts/native-dots.ts` opens a gateway on `https://localhost:8000` by default. The account, app settings, plugins and normal chats use the real application and CLI path. Endpoints that belong to a Dot go to the local Dots backend with a separate token. File endpoints try local Dot files first and fall back to the real account if nothing is found.

`scripts/native-cli-bridge.mjs` rewrites `workspaceRouting.backendOrigin` in the app-server `account/read` response to the local gateway address, only in the response sent to the app. Requests for a Dot such as `thread/read` and `thread/resume` are routed to the backend or worker that owns the thread. Normal Codex threads stay with the real installed CLI.

The application's feature flags are preserved. The visibility and compatibility fields that the native Dot screen needs are added to the local response. This is not an account plan upgrade or an entitlement to OpenAI's cloud Dots service. The native protocol can change between versions.

`scripts/main-codex/native-package.ps1` watches the installed package and stores the connection settings. `native-resume.cs` resumes the suspended start-up thread in this Windows mode and does not open a second copy of the app. The helpers are compiled locally; no Codex application or ASAR files are distributed in the repository.

## Command approval

The dashboard setting **Settings → Full access** is persistent and **off by default**. When it is off, Codex threads and turns start with `on-request` approval and a workspace-write sandbox, and commands wait for your approval. When it is on, thread and turn starts use `never` and `danger-full-access`, and worker tasks receive the same policy. Pending permission requests are then accepted without waiting. Real user questions still need an answer and proactive research stays read-only. Installations that already saved this setting keep their saved choice. [Computer modes](COMPUTER-MODES.md) describe the limits of full access.

## Linux computer and tools

The optional WSL2 computer opens a separate X11 display and Chromium profile for each Dot or computer. The native computer panel shows the full 1280×800 desktop: browser, terminal, files and native applications share the same screen.

**Take over** locks agent desktop and browser input; **Return control** gives it back. When the panel closes, control returns to the Dot. Desktop coordinates refer to the whole screen and browser tools work on page content.

Name, avatar and colour are applied to the local start page and the window theme. The theme is not a copy of OpenAI's own theme. Installation, applications, workspace and graphics limits are described in [LINUX-COMPUTER](LINUX-COMPUTER.md).

## Voice

The proxy voice path runs speech recognition, then the Dot model selected in the dashboard, then speech synthesis. The model does not need to provide a native Realtime API; the speech-to-text and text-to-speech providers are configured separately. Speech detection filters short noises and false transcripts caused by silence. Each call uses an execution thread separate from the main written chat.

When `followCodexVoice` is enabled and the local app and account support it, the voice selected in Codex is read and the app's speech service is used. The main account's session file is not changed, and a helper header file taken from a successful voice-list request does not store Authorization or Cookie values. This path depends on the account's usage limits and on the service and protocol version. A voice that the service rejects is never shown as a different voice.

## Shutting down and undoing

Close the Dots service console or stop it with `Ctrl+C`. The package activation record is released when the services stop. If you close Codex and reopen it from the original shortcut, the normal application path is used.

If the package record remains after an unexpected shutdown, run this in the project root while the Dots services are stopped:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/main-codex/native-disable.ps1
```

The local CA is not deleted automatically, so the same installation can reconnect. For a full removal, stop the services first, then remove the **Dots private gateway CA** entry that matches this installation's CA file from the current user's certificate manager.

`Restore-Main-Profile.cmd` only reverts records left by the older profile-replacement method. It does not enable or disable the new native connection. Keep backups private under `.data`.

## Test scope

The verified local Codex MSIX versions and checks are in [ACCEPTANCE](ACCEPTANCE.md). Windows API mechanism: [EnableDebugging](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging). Verify the real native launch separately on other Codex versions.
