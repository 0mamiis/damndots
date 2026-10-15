# Updates

The bottom of the sidebar shows the version of the **local dashboard installation**. It checks stable releases in `0mamiis/damndots` on GitHub, caches checks for an hour and retries a manual check at most once a minute. Drafts, prereleases and versions older than the installed version are ignored. Network errors keep the last successful result.

A notification is claimed atomically in the local server database once per release, across panel reloads and browsers. The update badge remains until the release is installed. Remote backends keep their own version and data; updating the dashboard never silently updates a different host.

## Installing from the panel

Use **Install update** in the version disclosure. The updater requires:

- A Git checkout with the official origin and no modified or untracked source files. It does not overwrite personal patches.
- All Dots services launched together through `Start-Dots.cmd` / `npm start`, so the supervisor owns the processes it must restart.
- No queued, running or approval-waiting tasks and no active computer jobs.

The current release is the first one with this updater. Upgrade to it manually once; future tagged releases can use the button. Source-archive, Docker and externally supervised/systemd installations need their normal deployment mechanism. They still get version checks and release links, but the button explains why installation is unavailable.

The updater fetches the specific published tag from the fixed repository, pins the resolved commit, requires a forward update, checks package/tag agreement, and creates an isolated Git worktree. It runs `npm ci`, typechecks and a production build there before asking the supervisor to stop its own children. New task admission is held during maintenance.

Only then does it fast-forward the source checkout, install locked dependencies, rebuild and restart with the previous stack arguments. It checks the server version, the new supervisor's readiness and the dashboard's HTTP response. If installation or health checks fail, it stops the replacement, restores the prior Git revision with `git reset --keep`, reinstalls/builds and restarts the old version. A failed rollback is visible in the panel and logs rather than being reported as success.

The updater never resets databases or overwrites `.env`, identities, provider keys or workspaces. It keeps the previous revision and durable progress under `<server-data>/updates`. Local logs are `update.log` and `restart.log`; the install lock prevents concurrent updates. If the updater crashes, a later server maintenance check exposes the failure and unlocks task admission. If a PC loses power during installation, start Dots and inspect those logs before retrying.

## Release publishing

Bump all package versions, the lockfile and root `releaseTag` together. Run the CI checks before publishing. Create a stable `vMAJOR.MINOR.PATCH` tag pointing to that exact commit, and publish a GitHub release. Merely pushing to main does not trigger update notifications. Never move an existing release tag.
