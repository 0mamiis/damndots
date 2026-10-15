# damndots v0.3.2

Safer defaults and a cleaner first install.

- **Full access is now off by default.** New installations ask for command approval; turning on Settings → Full access is a deliberate choice. Installations that already saved this setting keep their saved choice.
- **Agent-assisted install is the recommended setup.** The README points to [docs/AGENT-INSTALL.md](AGENT-INSTALL.md), a single prompt for Codex or another coding agent. The manual steps remain for advanced users.
- README and Security notes now state clearly that the Windows integration adds a user-level certificate authority and starts the managed Codex process with `--ignore-certificate-errors`, and that Codex updates can break the integration.
- Updates are never installed automatically: the sidebar shows a notice once, and **Install update** is always an explicit action. The README and Updates guide say so.
- Consistent defaults: the example `.env` no longer pins a model, reasoning effort defaults to `medium` everywhere, and `DOTS_GATEWAY_GUARD` is documented.
- The launcher scripts, restore scripts and all guides are in English.
