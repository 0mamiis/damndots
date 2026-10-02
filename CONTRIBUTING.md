# Contributing

Use Node.js 24. Install from the lockfile with `npm ci`, then install the test browser with `npx playwright install chromium` (Linux CI uses `--with-deps`).

Before submitting a change:

```sh
npm run typecheck
npm test
npm run build
npm run release:check
npm audit --audit-level=moderate
```

Tests use isolated temporary stores and controlled providers. They do not require real API keys or a Codex login. The native computer-client interoperability test is optional because the original client assets are not distributed. To enable it, set `DOTS_NATIVE_TEST_ASSETS` to the extracted `webview/assets` directory from your own installation; the currently supported fixture filename is documented in `apps/worker/test/stream.test.ts`.

Preserve API payloads, ownership checks, approvals, user conversations and existing provider settings. Report which checks you ran and distinguish controlled tests from real account verification. Never attach private `.data` contents to a PR.

The experimental native Windows integration depends on the installed Codex version. A green unit test suite alone does not prove that a new desktop release is compatible.
