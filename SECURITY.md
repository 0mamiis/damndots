# Reporting security issues

Do not include tokens, passwords, private keys, account files, browser profiles, database dumps or conversations in public issues.

Use this repository's **Security → Report a vulnerability** option when private vulnerability reporting is enabled. Otherwise contact the repository owner privately through the contact method listed on their GitHub profile. Include the affected version, reproducible steps and a redacted log.

## Deployment boundaries

- The dashboard is an owner/admin panel, not a multi-user hosted service. Its key grants access to files and computer tasks. Start it on loopback; use HTTPS and configure `DOTS_SERVER_URL` or `DOTS_ALLOWED_SERVERS` when hosting it remotely.
- Worker enrollment tokens are short-lived and single-use. Workspace roots constrain file/output APIs. Default Codex full-access shell tasks can reach other files accessible to the worker's operating-system user; use a separate Linux environment or a restricted execution setting when isolation is needed.
- `.data`, database files, credentials and certificates are private runtime state. Keep them out of Git and source archives. Back up the database and signing key together in private storage.
- Native Windows integration adds a local CA to the current Windows user's trust store and registers a package activation helper. The installed application and account files are not part of the source distribution. See [MAIN-CODEX](docs/MAIN-CODEX.md) for disabling the integration.
- `npm run release:check` scans the source distribution and any Git index for excluded files and common embedded secrets. It is a precaution, not a substitute for reviewing a public commit.
