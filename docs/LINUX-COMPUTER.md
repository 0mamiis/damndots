# Local Dot Linux computer

The optional **Dots-Computer-Debian** WSL2 distribution runs a real Debian 13 (trixie) desktop. The Dots services start the computer; they do not open a Codex window. Use the original Codex shortcut and assign this computer to a Dot from the dashboard.

Files live in `/home/dot/Workspace`. From Windows they are reachable at `\\wsl.localhost\Dots-Computer-Debian\home\dot\Workspace`. The Dot is a normal Linux user: there is no sudo and Windows drives are not mounted.

## Installing and updating

With WSL2 enabled and the Dots services stopped:

```powershell
node scripts/setup-linux-computer.mjs
```

The command downloads the official Debian root file system, verifies the layer hash against the OCI manifest and imports it into a separate WSL2 distribution. It installs packages, Node and the Codex CLI, a private local SSH tunnel and the worker sources. It does not replace an existing distribution of the same name created for another purpose; use `DOTS_LINUX_DISTRO` at install time for a new name. If you use a custom name, set the same variable when you start the services.

Chromium, a terminal, a file manager, Blender, GIMP, Draw, Go, FreeCAD, Godot, Inkscape, Kdenlive, KiCad, Code, Writer/Calc, QGIS, ParaView, OpenSCAD and 3D Slicer are installed. Versions depend on repository and release downloads; the hashes of the Godot and Slicer downloads are verified. Installation needs several GB of disk space and an internet connection.

To update the sources:

```powershell
node scripts/sync-linux-computer.mjs
# If the lockfile or dependencies changed, add --install-deps instead.
node scripts/restart-linux-worker.mjs
```

Restart only when the Dot has no running task. If the Dots services are running, the supervisor restarts the worker. Close and reopen the Codex computer panel. The active distribution is selected by `.data/linux-computer/active-distro` or `DOTS_LINUX_DISTRO`.

## Screen and control

Each Dot or computer uses its own X11 display and Chromium profile. The native Codex video panel shows the full desktop at 1280×800. **Take over** gives control to the user; **Return control** gives it back to the Dot. While the user has control, agent desktop and browser input is blocked.

The start page changes with the Dot's saved name, avatar and colour. This project applies its own theme; no official OpenAI theme, ISO or image file is distributed. This local computer does not run while the PC is off. Graphics are rendered in software, so do not expect hardware GPU performance for heavy 3D work.

## Streaming performance

The desktop is captured with a 30 FPS target; the real rate depends on PC load. FFmpeg does not delay the start for analysis and forwards each JPEG frame immediately. The canvas uses `requestFrame()` when a new frame is drawn; there is no separate 15 FPS timer ([captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)).

Only consecutive pending mouse positions are merged; click, key, scroll and control boundaries are preserved. The `xdotool mousemove --sync` wait was removed. A short delay is kept for Unicode keys so that X11 can see the temporary mapping.

In a local synthetic test on 2026-10-02, a click after 200 mouse moves dropped from 1728 ms to 246 ms; the live video ran at 28.7 FPS and normal clicks measured 117–145 ms. Typing `abcçışğ` was also verified. The measurement is not a guarantee for every application.

## Older installations

An Ubuntu **Dots-Computer** distribution from an older installation can be kept. Finish running tasks before you change the active distribution and restart the worker. Only one Dots Linux distribution should run at a time; the local SSH port is 22444.

`scripts/migrate-linux-state.mjs <source>` can move the old computer identity, threads and work files. The browser profile is not copied; sign in again in the browser if needed. Deleting the source distribution is not part of this command. `wsl --unregister` permanently deletes distribution data and is not used for source updates.
