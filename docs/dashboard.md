# Dots dashboard

The dashboard is written with Next.js 16 and **HeroUI v3** (React Aria + Tailwind CSS v4). There is no custom component CSS; the look comes from HeroUI components, HeroUI design variables and Tailwind classes. `apps/dashboard/app/globals.css` only sets the brand colour (`--accent`) and the `--muted/--success/--warning/--danger` values for contrast.

## Running it

```powershell
npm run build --workspace @dots/dashboard
npm run start --workspace @dots/dashboard -- --port 4320
```

The local Dots stack starts the dashboard automatically (default: http://127.0.0.1:4320). Signing in needs the server's admin access key (`apps/server/.data/server/admin.key`).

## Exposing it to other people

The dashboard makes server-side requests to the server address typed into the sign-in form. If other people can reach the dashboard, that lets them make it call addresses on its own network. When you publish it, pin the allowed server:

| Variable | Meaning |
| --- | --- |
| `DOTS_SERVER_URL` | The only Dots server the dashboard may connect to; the form is pre-filled with it. |
| `DOTS_ALLOWED_SERVERS` | Several allowed servers, separated by commas. |
| `DOTS_DASHBOARD_HOST`, `DOTS_DASHBOARD_PORT` | Listening address and port (default 127.0.0.1:3000; `--port` also works). |

Remote servers require HTTPS; only localhost may use HTTP. Put a TLS-terminating reverse proxy in front of the dashboard and forward `X-Forwarded-Proto: https`; the session cookie then becomes `Secure`. Cookies are `HttpOnly` and `SameSite=Strict`, and mutating requests are origin-checked. Responses carry `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` headers.

## Interface

- The interface is in English.
- Light and dark theme (follows the system preference, can be switched from the top bar, and the choice is remembered).
- On mobile the menu opens in a HeroUI Drawer; the page is kept in the `#section` part of the address, so a refresh keeps you on the same section.
- Saved changes are announced with a HeroUI Toast; errors appear under the form as an Alert.
- The live views update from the server event stream (tasks, messages, activity, approvals, computers, settings and attached threads), with a 15 second fallback refresh.
- In the voice settings there is a "Use the voice selected in Codex for calls" switch.

## Verification

`npm run test --workspace @dots/dashboard` tests the session and allow-list rules. The interface interactions (model/thinking/fast mode, switches, select boxes, required fields, notifications, section kept on refresh) and an axe accessibility scan were run in a real browser. The only remaining finding in the scan is React Aria's own screen-reader announcement container (`role=img`), which comes from the library.
