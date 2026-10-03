# Codex chat coordination

Dots can inspect real project chats, create requested tasks, send follow-ups and read results through optional Codex bridges. Installing a bridge grants its token holder access to the owner's chats; keep its token in a private runtime directory.

## Requirements

- Node.js 24 and working Dots native setup.
- Main host: an existing Codex app-server daemon with a control socket, using a complete CLI package. Tested with CLI 0.160.0 on Windows.
- Local desktop: Windows and an open Codex app. Tested with MSIX 26.930.3930.0. Native interfaces are experimental.
- Forwarding: a configured SSH alias with key authentication and an already verified host key. Listeners remain on loopback.

## Main Codex on the backend

Run elevated on the Windows machine owning the main Codex daemon:

```powershell
.\scripts\install-codex-main-bridge.ps1 -CodexCli <installed-codex-executable>
```

The installer defaults to the current Windows account. Set -User and -CodexHome together for another daemon owner. -Node, -Directory, -TaskName and -Port are configurable. No binaries, model settings or account files are copied.

The token-protected relay forwards to the existing daemon through codex app-server proxy, sharing real chats and writer locks. Its directory is restricted to SYSTEM, Administrators and the chosen user.

Backend environment overrides:

```dotenv
DOTS_MAIN_CODEX_URL=ws://127.0.0.1:9913
DOTS_MAIN_CODEX_TOKEN_FILE=<private-main-token-file>
# DOTS_MAIN_CODEX_DISABLE=1
```

Non-loopback connections require WSS. A private tunnel ending at loopback is also supported. The PowerShell installer is Windows-specific. A Linux backend can configure the Node relay through BRIDGE_CODEX_CLI, CODEX_HOME, BRIDGE_DIR, BRIDGE_TOKEN_FILE and BRIDGE_SOCKET; that deployment has not received native live verification.

## Local PC from a backend

After normal Dots native setup, run in ordinary PowerShell on the Windows PC:

```powershell
.\scripts\install-codex-local-tools-bridge.ps1 -SshHost <your-ssh-alias>
```

No private address or host alias is built into the source. The generated native gateway manifest supplies the local HTTPS certificate. Setup does not depend on an installation chat. Each request verifies the real sending Dot against the active native backend.

Transfer the generated token privately to the backend as local-token.txt. -TokenDestinationDirectory optionally copies it to an existing private Windows share directory. Otherwise use your established secure administration channel. Never put tokens in Git or a public share; their values are not printed.

Backend overrides:

```dotenv
DOTS_LOCAL_CODEX_URL=http://127.0.0.1:9914
DOTS_LOCAL_CODEX_TOKEN_FILE=<private-local-token-file>
# DOTS_LOCAL_CODEX_DISABLE=1
```

The PC uses port 9915 and SSH forwards backend loopback port 9914 by default. -LocalPort, -RemotePort, -Directory, -NativeManifest and -Node are configurable. Restart the helper after changing its configuration. The SSH alias and native gateway must address the same Dots backend. Host/account changes do not transfer chats.

## Execution and sender identity

Main-host codex_* tools use trusted project folders. New tasks follow the Dot execution preference: restricted mode uses workspace-write and on-request approval; full access requires explicit execution context. Approval requests are forwarded to the Dot approval UI while its coordinator task is active. Requests arriving after that coordinator ends are declined rather than silently approved.

Restricted mode refuses to steer an active chat whose permissions it cannot verify; wait for completion first. Full-access dispatch does not elevate unrelated existing user chats. Dot-created chats are updated to the current permission mode when continued.

Local local_codex_* tools retain the desktop's own permission behavior. With Dot automatic execution off, creating or messaging a local chat first requires an explicit dispatch approval.

New messages use Codex's native delegation envelope with the actual Dot thread as sender. Normal user messages and old history are not rewritten. Current and historical Dot roots retain their identity on native reads.

## Status and removal

```powershell
.\scripts\codex-bridge-status.ps1
.\scripts\uninstall-codex-bridge.ps1 -Role Local
# Elevated on the backend:
.\scripts\uninstall-codex-bridge.ps1 -Role Main
```

Removal stops only the selected relay, its own SSH child and its startup registration. Private tokens/config are preserved. The Codex daemon, projects, providers and Dots server are left intact.

Backend work can continue after a separate client PC disconnects while its daemon and provider remain running. Local work needs the PC and Codex app online; new instructions need an online client. This does not provide OpenAI cloud Dots access or automatically sync project files.

## Verification

Live Windows checks covered creation, follow-ups, replies, real Dot attribution and backend execution after client disconnection. Tests cover restricted/full permissions, denied approval after dispatch returns, busy-chat restrictions, sender provenance, historical routing and ordinary chat isolation.

Linux CI validates protocol/permission tests; it does not establish live Linux relay or native Windows UI compatibility.
