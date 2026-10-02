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

The dashboard currently uses Turkish labels. **Sunucular** manages host profiles and computer mode. **Ayarlar** manages model and execution settings. A host change is refused while tasks are running, and it does not move conversations between backends. Each backend keeps its own data.

## Pick a computer

**Bağlanan PC** uses the connected Windows user's real primary screen. It streams a scaled 1280×800 view to Codex and controls native applications through Windows input. **Take over** blocks agent input; **Return control** gives it back. The Windows session must be unlocked. Secure UAC and login screens are not controlled.

**Ayrı Linux ortamı** uses WSL2. Enable WSL2 in Windows first, then use the dashboard's **Linux bilgisayarı kur** form. It can download Debian 13 or import your own Debian 13 rootfs from a local `.tar`, `.tar.gz`, `.tgz` or `.wsl` file with its SHA256. It refuses to overwrite an existing distribution. ISO installers are not supported.

Linux setup installs a browser, terminal, file manager and desktop applications including Blender. It uses software rendering and takes several GB of disk space. See [computer modes](docs/COMPUTER-MODES.md) and [Linux setup](docs/LINUX-COMPUTER.md).

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
