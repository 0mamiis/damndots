# Agent-assisted install

Installing damndots by hand means Node.js 24, dependencies, Playwright, a dashboard build, a local certificate, the Codex integration and a model provider. A coding agent with shell access can do all of it and verify the result. This is the recommended way to install.

Open Codex, Claude Code or a similar agent on the PC where Dots should run and paste the prompt below. Keep the agent in its normal permission mode so you see what it runs. Do not give it your provider key in the chat; it will tell you where to type it.

## Prompt

```text
Install damndots (https://github.com/0mamiis/damndots) on this Windows PC and make it work end to end. Do the work yourself; only stop for a decision that I must make. If something fails or is unclear, ask me a short question instead of guessing.

Before changing anything:
1. Read README.md, SECURITY.md and docs/MAIN-CODEX.md in the repository.
2. Check that this is Windows with the Codex MSIX desktop app, and compare my Codex version with the tested versions in the README. If it is different, tell me before continuing, because the native integration may not work.
3. Make sure Node.js 24 and Git are available. Install Node.js 24 only if it is missing and tell me first.
4. Do not touch other apps, services, scheduled tasks, ports or files that already exist. If a port from .env.example is in use, pick a free one and tell me.

Install:
5. Clone the repository to a normal folder (not a synced or temporary folder), then run npm ci, npx playwright install chromium and npm run build --workspace @dots/dashboard.
6. Copy .env.example to .env. Keep command approval ON (the default); do not enable full access unless I ask.
7. Run Start-Dots.cmd, wait until the dashboard answers on http://127.0.0.1:4320 and give me the path of admin.key. Never print the key itself.
8. Tell me the dashboard address and ask me to add my model provider URL and key there (Providers page), test it, fetch models and activate it. Wait for me.
9. Open Codex from its original shortcut (Open-Codex.cmd if the shortcut does not work) and confirm that the Your dot tab appears. If Codex was already running, ask me to close and reopen it once.
10. Send one test message to a Dot and confirm that a reply arrives.

Rules:
- Explain in plain words what each step does the first time it matters, especially the local certificate and the Codex integration.
- Do not read, print or copy my API keys, tokens or the admin key.
- Do not turn on automatic updates or change anything outside the repository folder, except what the README says the Windows integration installs.
- At the end give me a short list: what was installed, where, how to start and stop it, how to undo the Codex integration (Restore-Main-Profile.cmd and docs/MAIN-CODEX.md), and anything that did not work.
```

## Things to expect

- A Codex update can break the native integration until the project is updated. Check the project releases before updating Codex.
- Updates of Dots itself are never installed automatically. The sidebar shows a notice once, and **Install update** is always your decision. See [Updates](UPDATES.md).
- Full access (no command approval) is off by default. Turn it on only under **Settings** if you accept that tasks can act with your Windows user's permissions.
- To remove the integration, follow [MAIN-CODEX](MAIN-CODEX.md).

