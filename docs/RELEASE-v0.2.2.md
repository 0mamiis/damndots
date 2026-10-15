# damndots v0.2.2

Messages sent to a Dot while it is working are now delivered to the running turn, the dashboard is fully in English, and the launcher follows newer Codex desktop builds.

- **Live messages.** A chat message sent while the Dot is already running a turn on the same thread used to wait until the whole turn ended. It is now delivered to the running Codex turn (`turn/steer`), so the Dot can react at once. If the turn cannot accept it (already finished, waiting for approval, voice call, attachments), the message stays queued exactly as before. Remote computers route the steer through the existing read-only RPC channel (`turn/steer` joined the allow-list).
- **English dashboard.** All dashboard text, server error messages, the browser viewer page, the computer start page and the launcher messages are in English. The dashboard `lang` and date formatting follow.
- **Live updates.** The dashboard now also refreshes on computer registration/removal, settings changes, attached threads and finished worker jobs, instead of waiting for the 15 second fallback.
- **Newer Codex builds.** The launcher re-applies the proxy environment when it changes, treats a stale launch lock held by a PID of another account as stale, retries the Dot thread lookup while the backend starts, and remembers proven Dot thread ids across restarts so a reopened Dot chat is not sent to the local CLI.

Validation: runtime tests for live delivery, fallback and voice/attachment exclusion; workspace tests and typechecks; dashboard production build; release source checks. `turn/steer` was also exercised against a real Codex app-server from a second connection while a command was running.
