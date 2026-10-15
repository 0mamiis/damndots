# Publishing on GitHub

The sources are shared under the MIT licence. The repository contains no keys, accounts, browser profiles, chat/job databases, avatars or extracted Codex application files. A distributable source package is created without deleting any local data.

## Checks

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run release:check
npm audit --audit-level=moderate
npm run release:source
```

GitHub Actions runs the same checks on Windows and Ubuntu. If the workflow has not run on GitHub yet, do not present local results as a GitHub CI result. The native Codex test is skipped explicitly when the private client files are not provided.

`release:check` scans the sources to be distributed. If the repository is a Git checkout, it also checks the files in the index and in the commit; `.gitignore` does not remove secrets that were tracked earlier. It does not scan old commit history automatically. If a secret was ever published, deleting it is not enough: revoke the key and review the history separately.

`release:source` produces a source ZIP named after the `releaseTag` in the package metadata and a `manifest.json` with the file hashes. For v0.2.0 the path is `.data/releases/damndots-v0.2.0-source.zip`. The package is not uploaded to GitHub automatically. Use a new tag and package for every new version; do not change the ZIP contents of an earlier tag.

## First repository

Extract the archive into a **new, empty directory** and push only that clean source directory to GitHub. This keeps the runtime data and test helpers of this development folder out of the repository.

```sh
git init -b main
git add .
git diff --cached --stat
git diff --cached --check
npm run release:check
git commit -m "Initial self-hosted Dots source"
```

After you choose the repository name and visibility on GitHub and create it, use the remote commands that GitHub gives you. The source package is not a backup of the local `.data` directory.

## Limits to state in release notes

- The native integration is experimental and depends on the Windows MSIX and Codex version. The known locally accepted version is in [ACCEPTANCE](ACCEPTANCE.md).
- The Linux desktop is a local Debian install; OpenAI's own cloud image is not distributed.
- The dashboard is for a single administrator. If it is exposed to the internet, HTTPS and allowed backend addresses must be configured.
- Controlled protocol tests for Slack, Teams, email and GitHub do not mean full acceptance on real accounts.
- Docker images must be verified separately; do not say "Docker tested" based only on reading files on a machine without Docker.

Enable private vulnerability reporting in the GitHub repository settings. The automatic CI and Dependabot files are included in the source distribution.
