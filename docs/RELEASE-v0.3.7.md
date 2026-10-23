# damndots v0.3.7

Telegram is now part of damndots. Open **Telegram** in the sidebar to connect a bot to a Dot, restrict it to your private Telegram account, and mirror Codex/dashboard messages and Dot replies.

- The server encrypts the saved bot token and never returns it to the dashboard. Unknown users and group chats cannot submit messages.
- Connection checks, test messages, enable/disable controls and disconnect are available in the dashboard. No separate Python process or public webhook is required.
- Polling offsets and delivery receipts survive restarts. Long text is split safely; uncertain deliveries are shown without automatically duplicating them. Photos and voice inputs are not supported yet.
- The migration command documented in [Telegram setup](TELEGRAM.md) imports the earlier standalone bridge without replaying delivered messages.
- The local Codex bridge discovers the newer `codex-app-tools-*` pipe as well as the older pipe name. A local chat can select its model explicitly.
- Compatible dependency updates address the current Next.js, Fastify and IP-address parsing security advisories.

Validation: controlled tests cover owner-only access, token encryption/redaction, administrator-only endpoints, mirroring, deduplication, Unicode splitting and ambiguous delivery. The dashboard was built and tested in a real browser; an existing Oracle installation was migrated, and a real Dot message and reply were delivered to Telegram. Local Windows Codex chat creation with a selected Gemini model was also verified. These account-specific checks do not guarantee compatibility with every Codex release or provider.

Existing Codex desktop application patches, personal accounts and server-specific configuration are not distributed in this release.
