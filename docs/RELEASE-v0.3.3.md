# damndots v0.3.3

A security hardening release after an active test pass (169 routes against forged, expired and role-swapped credentials, plus malformed-input fuzzing; no authentication bypass was found).

- Malformed bodies sent to `/auth/oauth/revoke`, `/backend-api/wham/statsig/bootstrap` and `POST /backend-api/tbo` now produce a client error or a harmless reply instead of a server error.
- A regression test covers these requests.
