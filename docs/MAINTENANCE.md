# Maintenance and local safety

## Data retention

Dots trims old operational records automatically (at start-up and every 30 minutes) so the dashboard, computer polling and lookups stay fast as an installation ages. Chat messages, tasks, outputs, memories, schedules, approvals, settings and credentials are never trimmed.

| Records | Kept |
| --- | --- |
| Live-stream replay log (`events`) | The newest 2,000 |
| Raw Codex notifications (`activity`) | The newest 20,000, and anything younger than 90 days |
| Finished computer jobs (`worker_jobs`) | The newest 100 per outcome, and anything younger than 24 hours. Queued and running jobs are never removed |

The limits live in `apps/server/src/retention.ts`. Deleted rows free space inside the SQLite file for reuse; the file itself does not shrink.

## Live dashboard stream

A new dashboard connection receives live events only, because the dashboard loads its current state over the API. A reconnecting browser sends its last event id and receives what it missed. If it missed more than 1,000 events it gets a `resync` event and refreshes.

## Local gateway

The desktop gateway on `https://localhost:<port>` adds the Dots credentials to the requests it forwards. It therefore refuses requests a web page could cause the browser to send:

- a request target that is not a plain path (`//host/...` would be read as another host),
- any `Origin` of an http(s) site other than localhost, chatgpt.com or openai.com,
- cross-site `no-cors` or `navigate` loads, and
- requests from sandboxed or app origins that carry no `Authorization` header, because a page cannot add one without a CORS preflight.

Blocked requests are reported on the console of the service that runs the gateway. If a legitimate client is ever refused, set `DOTS_GATEWAY_GUARD=log` to only report what would be refused (with a secret-free description of each kind of request), or `DOTS_GATEWAY_GUARD=off` to disable the checks, and restart Dots.
