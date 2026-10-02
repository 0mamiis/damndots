# damndots

Self-hosted Dots for the Codex desktop app. Run the backend on your PC or a server, choose your own model provider, and use the existing **Your dot** interface in Codex.

**v0.1** is an experimental release. The native integration was tested with Codex MSIX **26.930.2377.0** on Windows. It depends on desktop protocols that can change between Codex releases. This project is independent of OpenAI and does not grant access to OpenAI's cloud Dots service.

## What works

- The original Windows Codex app, with its existing account and history. The launcher starts services; you open Codex yourself.
- A HeroUI dashboard for model providers, Dots, tasks, outputs, memory, schedules, connections and voice settings.
- Responses and Chat Completions providers, model discovery, reasoning settings and optional priority mode where supported.
- Host profiles with encrypted credentials, connection tests and switching between a local backend and an HTTPS backend.
- Computer control using the connected Windows PC's real desktop, or a separate Debian desktop in WSL2. PC mode is the default.
- Persistent tasks, cancellation, delegation, worker enrollment and revocation.
- A voice pipeline using speech recognition, the selected Dot model and speech synthesis. The installed Codex voice can be used when the account and service support it.

Slack, Teams, email, GitHub, MCP and signed webhooks have adapters. Their protocol tests use controlled services; real account setup is still required. See [the verification record](docs/ACCEPTANCE.md) for what was actually tested.

## Start on Windows

You need Node.js **24**, npm, the Codex **MSIX** desktop app, and a model provider with tool calling support. The app's installed CLI is detected automatically. Set `DOTS_CODEX_CLI` if you need to point to another executable.

```powershell
git clone https://github.com/0mamiis/damndots.git
cd damndots
npm ci
npx playwright install chromium
npm run build --workspace @dots/dashboard
Copy-Item .env.example .env
.\Start-Dots.cmd
```

Open [the dashboard](http://127.0.0.1:4320). Its login key is generated in `apps/server/.data/server/admin.key`. Add a provider URL and API key, test the API format, fetch or enter a model, and activate the provider.

Once the services are ready, open Codex from your original shortcut. If Codex was already running during initial setup, close and reopen it once. `Start-Dots.cmd` does not open another Codex window or replace your shortcuts.

The dashboard UI currently uses Turkish labels. Use its host-management section to configure backend connections and computer mode, and its settings section to select the model and execution policy. A host change is refused while tasks are running, and it does not move conversations between backends. Each backend keeps its own data.

## Pick a computer

**Connected PC mode** uses the connected Windows user's real primary screen. It streams a scaled 1280×800 view to Codex and controls native applications through Windows input. **Take over** blocks agent input; **Return control** gives it back. The Windows session must be unlocked. Secure UAC and login screens are not controlled.

**Separate Linux mode** uses WSL2. Enable WSL2 in Windows first, then use the Linux setup form in the dashboard's host-management section. It can download Debian 13 or import your own Debian 13 rootfs from a local `.tar`, `.tar.gz`, `.tgz` or `.wsl` file with its SHA256. It refuses to overwrite an existing distribution. ISO installers are not supported.

Linux setup installs a browser, terminal, file manager and desktop applications including Blender. It uses software rendering and takes several GB of disk space. See [computer modes](docs/COMPUTER-MODES.md) and [Linux setup](docs/LINUX-COMPUTER.md).

### Download the prepared Linux image

The [Linux v0.1 release](https://github.com/0mamiis/damndots/releases/tag/linux-v0.1) provides the prepared Debian 13 desktop as a compressed WSL2 rootfs. The download is **3.64 GB (3.39 GiB)**, split into two parts below GitHub's per-file limit. The package manifest lists the exact size and SHA256 for each part and the assembled image. After import, the desktop uses roughly 13 GB of disk space before additional user data; the download size is not the installed size.

From a current checkout, download and verify it with:

```powershell
node scripts/download-linux-image.mjs
```

The command downloads both parts, checks their hashes, joins them and verifies the combined archive. In the dashboard's custom Linux image form, enter the resulting file path and SHA256 printed by the command. Choose a new WSL distribution name; existing distributions are never overwritten.

For command-line installation, keep the same checkout and set:

```powershell
$env:DOTS_LINUX_DISTRO = 'Damndots-Computer'
$env:DOTS_LINUX_IMAGE = (Resolve-Path '.data/linux-computer/ready-image/damndots-linux-v0.1.tar.gz').Path
$env:DOTS_LINUX_IMAGE_SHA256 = (Get-Content '.data/linux-computer/ready-image/manifest.json' -Raw | ConvertFrom-Json).sha256
node scripts/setup-linux-computer.mjs
```

The image includes the desktop applications, but excludes build-machine accounts, browser profiles, credentials and work files. Setup generates this installation's SSH keys and synchronizes the worker from your checkout. Microsoft VS Code is downloaded from Microsoft during setup rather than redistributed in the image. The release includes the package inventory, license notices and corresponding-source retrieval information.

## Execution access

Dot tasks default to Codex `danger-full-access` with `approvalPolicy: never`, including resumed threads and worker tasks. Commands run with the operating-system permissions of the worker user. Workspace roots identify starting directories and constrain file/output APIs; they are not a shell sandbox in full-access mode.

The dashboard can change this setting. Actual questions still need an answer, proactive research stays read-only, and app tools remain subject to configured connector scopes. [Security notes](SECURITY.md) describe the deployment boundaries.

## Hosting

The backend and dashboard can run on Linux or a VPS. Keep public access behind HTTPS, or use an SSH tunnel. The dashboard is a single-owner admin panel, not a multi-user service. Set `DOTS_SERVER_URL` or `DOTS_ALLOWED_SERVERS` when exposing it remotely.

```sh
docker compose up --build -d
docker compose exec server cat /data/admin.key
```

The Compose example exposes the backend and dashboard on host loopback only. Configure a model provider after login. It does not install Windows native integration or a WSL desktop. Docker runtime verification is still pending; the source and local Windows/Debian test results are documented separately.

STUN/TURN settings for computer video are available in the dashboard. You supply the service and credentials. A real VPS/TURN deployment has not been verified yet. A local computer cannot keep working while the PC is off.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run release:check
npm audit --audit-level=moderate
```

GitHub Actions runs these checks on Windows and Ubuntu. The optional native computer-client test requires assets from your own Codex installation; those assets are not included here.

`npm run release:source` creates a source-only ZIP in `.data/releases`. Runtime state, credentials, backups, browser profiles, installed Codex files and build output are excluded. See [release instructions](docs/RELEASING.md) and [contributing](CONTRIBUTING.md).

[Native connection](docs/MAIN-CODEX.md) · [Providers](docs/PROVIDERS.md) · [Dashboard](docs/dashboard.md) · [Integrations](docs/INTEGRATIONS.md) · [Voice](docs/NATIVE-VOICE.md)

MIT licensed. Dependencies and separately installed applications keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
