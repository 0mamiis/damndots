# damndots v0.3.0

- The sidebar now shows the installed version and stable GitHub release status, on desktop and mobile.
- A new-release notification appears once per release, persisted on the local server.
- The update button stages and builds the selected release, blocks new work during maintenance, restarts the managed stack, and rolls back if startup checks fail.
- Updates preserve settings and data, reject local source changes, and only use the official repository. Unmanaged/source archive installations show actionable guidance instead of attempting to stop unrelated services.
- Includes the image-only message fix from #25.

See [Updates](UPDATES.md) for supported installation layouts, recovery and publishing.
