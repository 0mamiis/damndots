# damndots

Self-hosted Dots for the Codex desktop app. Run the backend on your PC or a server, choose your own model provider, and use the existing **Your dot** interface in Codex.

**v0.1** is an experimental release. The native integration was tested with Codex MSIX **26.930.2377.0** on Windows. It depends on desktop protocols that can change between Codex releases. This project is independent of OpenAI and does not grant access to OpenAI's cloud Dots service.

## What works

- The original Windows Codex app, with its existing account and history. The launcher starts services; you open Codex yourself.
- A HeroUI dashboard for model providers, Dots, tasks, outputs, memory, schedules, connections and voice settings.
- Responses and Chat Completions providers, model discovery, reasoning settings and optional priority mode where supported.
- Host profiles with encrypted credentials, connection tests and switching between a local backend and a remote one over HTTPS or Tailscale. The computer can be this PC, a WSL Linux desktop or any computer registered on the backend.
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

## Where things run

Two choices are independent: where the **Dot** (the backend that holds its history, schedules and model access) runs, and which **computer** it controls.

| Dot runs on | Computer | How |
| --- | --- | --- |
| This PC | This PC | The default. Nothing to set up. |
| This PC | Another PC or a VPS | Install a worker on that machine (below), then set this host's computer to **Server computer**. |
| A VPS or another PC | This PC | Add the remote backend under **Servers** and use it. Leave the computer on **Connected PC**. |
| A VPS or another PC | A computer on that backend | Add the remote backend, attach a worker to it, and set the computer to **Server computer**. This PC only runs the local Codex proxy. |

The local proxy that connects the Codex app to the active backend always runs on this PC; it is what makes the **Your dot** tab talk to your backend instead of OpenAI. The dashboard's **Servers** page shows the active layout, lists the computers registered on a backend, and shows whether the backend is reachable over Tailscale.

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

### Connect another Windows computer

A Dot can use a different Windows machine, for example a VPS you reach over Remote Desktop. The worker connects out to the Dots backend, so the backend never has to be on the public internet. Plain HTTP is accepted for loopback and for Tailscale addresses, because Tailscale already encrypts that traffic; every other remote address must use HTTPS.

1. Make the backend reachable on your tailnet. In the dashboard open **Servers → Network access** and press **Open to tailnet**, or run `tailscale serve --bg --tcp 9340 tcp://127.0.0.1:9340`. The port is forwarded to the tailnet only, never to the internet.
2. On the other machine, open an elevated PowerShell and run [scripts/install-windows-worker.ps1](scripts/install-windows-worker.ps1) with `-ServerAddress <tailnet IP>`. It unpacks a private Node.js 24 under `C:\Dots`, installs the worker and Codex CLI, joins the tailnet and registers a logon task. An existing Node.js on that machine is not touched. The dashboard shows this exact command, with the address filled in, next to a new enrollment code on the **Computers** page.
3. Start the worker once with `C:\Dots\start-worker.cmd --enrollment <code>`. Codes are single use and expire after 10 minutes.

The worker runs in connected PC mode by default and uses the screen of the Windows session it is started in. A Remote Desktop session loses its display when its window is minimized or closed, which breaks screen capture. The installer registers a `DotsKeepDesktop` task that moves a disconnected session to the console, so close the Remote Desktop window with X instead of minimizing it. [scripts/enable-keep-desktop.ps1](scripts/enable-keep-desktop.ps1) registers the task on an existing install (`-Now` also moves the current session). With full access enabled the Dot acts with that Windows user's permissions, so use a separate non-administrator user on any machine that hosts other services.

### Run the backend on a Windows VPS

The same installer can host the backend itself:

```powershell
.\install-windows-worker.ps1 -Role Server   # headless backend, started at boot, forwarded to the tailnet
.\install-windows-worker.ps1 -Role Both     # backend plus a worker, so the Dot runs on and controls this machine
```

The backend runs from `C:\Dots\server-data` as a `DotsServer` task. It has no dashboard of its own: add it from the dashboard on your PC under **Servers → Add host** using `http://<tailnet IP>:9340` and the admin key from `C:\Dots\server-data\admin.key`. Read that file on the VPS and keep it out of chats and screenshots. The install folder is readable only by SYSTEM and Administrators. Configure a model provider on the new backend; it cannot reach a provider that only listens on your PC's loopback unless that provider is also exposed to the tailnet.

Once the host is added, its card on **Servers** can issue a computer enrollment code together with the install command for the machine to attach (run it on the VPS itself for a Dot that runs on and controls the VPS), and can copy a Dot's name, model and instructions to the new backend. Avatars and chat history are not copied. Then press **Use this host** with the computer mode set to **Sunucuya bağlı bilgisayar** (server computer).

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
