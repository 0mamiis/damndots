# Computer modes

In the Servers section, choose the **Dot's computer** in a host's connection settings. The default is **Connected PC**. Saving stores the options; **Apply settings** changes the worker processes of the selected host. A mode or host change is refused while tasks are running.

## Connected PC

The Windows worker captures the real user's primary screen, streams it to the Codex computer panel scaled to 1280×800 and forwards mouse and keyboard events with Windows SendInput. Open browsers, terminals and native applications are part of the same screen. PC mode is not a virtual environment: it acts on the user's real screen.

Take over blocks agent input; Return control gives it back. Only one Dot panel at a time can hold user control on the same PC. When the panel closes, injected pressed keys are released. The screen resolution and the video coordinates are scaled, and v0.1 uses the primary monitor. The Windows session must be unlocked. The Windows lock screen and the UAC secure desktop are not controlled.

`dot_desktop_action` is for the real PC screen. `dot_browser_action` drives a separate automation browser. A model that should use the browser already open on the PC must choose the desktop tool.

## Linux

The **Set up Linux computer** form in the dashboard sends an installation job to the local service controller. WSL2 must already be enabled in Windows; this feature does not enable the WSL feature of the operating system on its own.

You can download the official Debian 13 rootfs or select your own `.tar`, `.tar.gz`, `.tgz` or `.wsl` image built for the same system. A custom file needs its absolute path on this Windows PC and its SHA256. The distribution name starts with `Damndots-`. If the hash does not match, nothing is imported. An existing WSL distribution is never overwritten. If a wrong distribution version is found after the import, the new distribution is kept and an error is shown; existing distributions are not deleted. A custom image belongs to the user: the hash proves the file did not change, it does not make its contents trustworthy.

An ISO is not a WSL rootfs and is not supported by this installer. Setup expects the Debian 13 desktop packages and makes no claim of compatibility with every Linux distribution. After setup, choose Linux as the host's computer mode and apply. Details are in [LINUX-COMPUTER](LINUX-COMPUTER.md).

## Full access

Full access is **off by default**. In that state Codex tasks ask for command approval (`on-request`, workspace-write sandbox). When you turn on **Settings → Full access**, Dot tasks run in the Codex app-server with `approvalPolicy: never`, `sandbox: danger-full-access` and `sandboxPolicy: dangerFullAccess` on every new turn. This setting is also carried in the worker payload, so an older sandbox setting does not survive a thread resume. Execution approval requests left over from an older client are accepted without waiting. Turning the setting off applies the approval policy again.

Full access is limited by the operating system permissions of the Windows or Linux user; it does not create administrator or root rights. Working directories are used for task start, file tools and output collection. They are not a sandbox that stops a full-access shell from reaching other accessible files. Use a separate Linux environment or a restricted Windows user when isolation matters.

Real user questions are never made up automatically. Proactive research tasks stay read-only. External app tools work only with predefined connection scopes.

## Computer connected to the server

The third mode, **Computer connected to the server**, does not run a worker on this PC. It uses a computer that is already registered with the active backend, for example a VPS or another Windows PC connected from the Computers section. In the host settings, pick one from the **Computer on the server** list. If you leave it empty, the first online computer is selected. **Apply settings** makes the selected computer the default and changes the computer of every Dot on this backend to it. If the selected computer does not exist or none is online, the change is refused and the active host does not change.

This mode works with a local backend (the Dot runs on this PC and the computer is remote) and with a remote backend (the Dot and the computer are both remote). To connect a remote computer, see the “Connect another Windows computer” section of the [README](../README.md). The **Network access** section of the dashboard shows whether the backend is open over Tailscale and opens it with one button. The enrollment key on the Computers page generates the command to run on the remote machine together with this address.
