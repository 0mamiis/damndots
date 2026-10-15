# damndots v0.3.4

The dashboard now follows the active host.

- When Codex is switched to another host (for example from this PC to a VPS) outside the browser, the dashboard used to keep showing the old local server, so the overview looked frozen with old tasks and activity. It now checks the active host when it opens, every 30 seconds and when the tab regains focus, and switches to it by itself.
- The check only reads state: it opens a session on the active host and never changes the connection.
- New read-only endpoint `GET /api/v1/connections/active-session` with a test.
