# damndots v0.3.5

Compatibility check against Codex **26.1013.3656.0** (CLI 0.163.0-alpha.10.2).

- The Codex desktop app started with the Dots gateway environment loads the **Your dot** entry from the local gateway on this build, and the start-up shows no page errors.
- The Dots server already answers the Dot routes this build uses: `/tbo/primary`, `/tbo/by-thread/{id}`, `/tbo/{id}/threads` and `runtime/pause` / `runtime/resume`.
- This build also calls `POST /tbo/{id}/onboarding/initialize` and `DELETE /tbo/primary`, which Dots does not implement yet. Setting up a brand-new Dot from the app on this build has not been tested; sending messages to an existing Dot was not re-run for this build either.

No server behaviour changed in this release; the README now lists the checked Codex versions.
