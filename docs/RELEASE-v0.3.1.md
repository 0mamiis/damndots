# damndots v0.3.1

A bug-check release. The measured problems below were found by running the proxy against real data (about 44,000 stored events and 30,000 activity records).

**Dashboard and server speed**

- A new dashboard connection used to replay every stored event: 53 MB over the live stream. It now follows live events, and a reconnecting browser receives only what it missed (or an explicit `resync`).
- Computers polled the server two to three times a second, and each poll parsed the whole job table (up to 20 MB of stored prompts and tool definitions). Job, task and activity lookups now use indexes: 200 polls with 3,000 stored jobs went from 2.1 s to 0.17 s, and the cost no longer grows with history.
- `/overview` and `/activity` returned all activity (39 MB). They are now bounded (`/activity?limit=`, default 1,000, at most 5,000).
- Old replay events, raw activity and finished computer jobs are trimmed automatically; see [Maintenance](MAINTENANCE.md). Messages, tasks and settings are never trimmed.
- Records saved in the same millisecond keep the order they were created in.

**Security**

- The local gateway built its upstream URL from the raw request target, so `GET //other-host/backend-api/x` was forwarded to `other-host` together with the Dots access token. Any web page could make the browser send that to `https://localhost`. Such targets are now rejected, and requests that come from web pages are refused (details in [Maintenance](MAINTENANCE.md)). A regression test sends the exact request and checks nothing leaves the machine.

**Updater**

- On Windows the updater was started by a service the supervisor stops as a process tree, so it would have been stopped together with it. It now starts through a launcher outside that tree (verified by a test that stops the tree).
- A failed release check (for example right after boot, before the network is up) retried only after an hour. It now retries after 30 seconds, doubling up to 15 minutes.
- Dependencies are reinstalled only when a package file changed, which shortens the time Dots is down.
- The one-time notice is no longer used up by a background tab.
- Idle polling no longer reads the task and job tables.

**Smaller fixes**

- A request written to the Codex bridge just as the CLI exits no longer risks an unhandled error.
- The model proxy and gateway stop writing as soon as the client disconnects.
