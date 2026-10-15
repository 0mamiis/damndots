# Acceptance and verification scope

This record covers what was checked in earlier releases (v0.2 era). It is not a statement about every later release or every Codex version. Run `npm test` and the CI checks for the version you use.

## v0.2 Codex chat coordination

On 2026-10-03, on Windows MSIX 26.930.3930.0 / CLI 0.160.0, real chat creation, follow-up messages, reading replies and the Dot sender identity were checked for a PC and a Windows backend. It was verified that a backend task finished after the starting client disconnected.

The released sources contain no personal address or SSH name. Main Codex chats use the Dot permission context; restricted-mode tests verify that execution is not upgraded to full access, that a later permission request can be denied, and that no unsafe steering is sent to an active chat. Local Codex dispatch asks for explicit dispatch approval in restricted mode. The sender identity comes from the real Dot record.

Windows and Linux GitHub CI results are stated in the relevant PR and release notes. Automatic protocol tests on Linux do not mean that real native relay or every desktop version was verified on Linux. The [chat management document](DOT-CODEX-CHAT-MANAGEMENT.md) applies to bridge removal and installation options.

## Local source checks

On 2026-10-02, with Node.js 24 and a clean source package, **137 tests passed and 1 was skipped** on Windows: client 13, dashboard 6, server 104, worker 12, source package 2. On Debian **136 passed and 2 were skipped**; the Windows-specific backup test does not run there. On both platforms the official Codex computer client test is skipped explicitly because the private client files were not provided; those files are not distributed.

`npm run typecheck`, installing and building the clean source package, source and key scanning, and dependency audit results are run separately before release. Results must be written into the release notes after the actual run. Having a GitHub Actions file does not mean GitHub CI has run.

## Live local checks

In the Windows checks after PC mode was added, client 14, dashboard 6, server 115, worker 12 and source package 2 tests passed. The worker test that needs private client files is skipped in normal source tests. The new Windows desktop, the native Codex video client and the takeover block were also tested live; a full-access task read a Windows project file with **0 permission requests**. The custom rootfs form and hash rules were checked; no real installation was done with a user image because none was provided.

| Area | What was actually checked | Scope limit |
| --- | --- | --- |
| Native Windows | Dot list, profile, avatar, messages/replies, main settings/history in the original MSIX app | Known local version 26.930.2377.0; not guaranteed for all Codex versions |
| Linux computer | Debian WSL2 desktop, native video client, control handover, terminal input, Blender and reconnection | Local WSL; VPS/TURN and hardware GPU acceleration were not checked |
| Computer latency | Separate Linux desktop → Windows native client; click after 200 moves 1728 ms → 246 ms, final stream 28.7 FPS | Synthetic measurement, not constant performance in every application |
| Models | Real local provider and a tool-calling task; controlled Responses/Chat Completions, SSE, error/timeout tests | Not every custom model supports tools, voice or reasoning the same way |
| Dashboard | HeroUI v3; desktop/mobile, themes and 15 interface flows with real local data | Requests were intercepted in UI write tests; no real user data was changed |
| Voice | Audio stream over WebRTC from the real account speech service; controlled STT/TTS, VAD, interrupt and separate voice thread tests | No live acceptance for every microphone, language or provider |
| Connections | Controlled real protocol requests for Slack/Teams/email/GitHub/MCP/webhook | No full end-to-end acceptance with real external accounts |

Local test screenshots, account details and `.data` evidence files stay in a private working directory; the public repository does not contain them.

## To verify separately after publishing

- GitHub Actions results for Windows and Ubuntu in the new repository.
- Building, starting and signing in to the Docker images in an environment that has Docker.
- A new WSL install and native MSIX launch under another Windows account or directory.
- Real external account connections and different Codex updates.

These limits should be read together with the [README](../README.md) and [RELEASING](RELEASING.md).
