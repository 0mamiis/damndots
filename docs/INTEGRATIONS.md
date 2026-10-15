# Real connections and voice

Connections run on the service side. A connection created in the dashboard being `configured` does not mean the account connection was verified. `POST /api/v1/connectors/:id/test` makes a real provider request; only a successful provider response produces the `connected` status. Missing fields give `needs_configuration` and a provider error gives `error`. A healthy connection does not guarantee that the token you supplied has every API scope; scope errors come back on the real call.

`IntegrationService` writes the configuration to SQLite encrypted with AES-256-GCM. `encryptionKey` is a 32-byte Buffer or its base64 form. In production keep this key in an environment secret and store it safely together with the data backup; if the key is lost the configuration cannot be decrypted. The service must not start with a random temporary key. In API responses the fields `token`, `secret`, `password`, `apiKey`, `authorization`, `headers` and `credential` are masked. PATCH objects merge; the value `[redacted]` keeps the old secret and `null` removes it. Edits put the connection back into the `configured` state.

Sending and writing tools wait for the `authorizeSend(connector, toolName, arguments)` approval hook. If there is no hook or it refuses, no write request goes to the provider. A reply to an incoming message on its own verified channel can be allowed separately with an explicit `autoReply:true` connection permission; this permission does not extend to normal tool sends. Slack history reads, IMAP reads and GitHub reads are enabled with separate scopes. A tool that announces MCP `readOnlyHint: true` must **also** be in the connection manager's `config.readOnlyTools` list; otherwise it asks for approval. A provider's annotation or hint grants no authority. `call(..., {readOnly:true})` runs only tools that were explicitly granted read authority; proactive tasks must use it. `isReadOnlyTool(id,name)` passes the real policy information to the native tool list. Remote HTTP providers require HTTPS; HTTP is accepted for localhost for controlled tests and local services. HTTP requests that carry Authorization do not follow redirects, and MCP SDK connections cannot leave the configured origin. Tokens and secrets cannot be placed in URL query fields; provide them in separate secret/header fields.

## HTTP and runtime connection

The admin CRUD/test/tools/call endpoints use the contract in [ARCHITECTURE.md](./ARCHITECTURE.md). The provider webhook URL is `/integrations/:id/webhook`; it reaches the `IntegrationService.webhook(id, headers, rawBody: Buffer)` method that the root server wires up **with the bytes exactly as received**. Parsing and re-serializing the JSON would break the signature. The webhook endpoint does not require the dashboard session token; it is verified by the provider signature or JWT. The raw body is at most 1 MiB.

The `dotId` in the configuration selects which Dot an incoming message is delivered to. The service calls `inbound(dotId, text, channel, requestId)`. `requestId` is prefixed with the connection id; a successful delivery is recorded in SQLite, and repeats of the same event, in parallel or after a restart, are not delivered. The runtime must also preserve the requestId: if the process stops after a successful delivery but before the receipt is written, the runtime's own message idempotency check handles the repeat. A failed delivery creates no receipt and can be retried. The time window for Slack and generic webhook signatures is 300 seconds; keep machine clocks in sync.

`pollEmail(id)` reads IMAP messages with a persistent UID/UIDVALIDITY cursor and sends them to the same inbound hook. `start({emailPollMs?,outboxRetryMs?})` polls enabled email connections every 30 seconds by default, without overlapping for the same connection. `stop()` removes the timers and waits for running work. The admin `/api/v1/connectors/:id/poll` endpoint triggers the same poll by hand; if it collides with the periodic poll it waits for the same Promise. One call takes at most 100 messages; the next call continues from the cursor. When UIDVALIDITY changes, the new mailbox order is read from the start. The allowed-sender check matches the real parsed address exactly. The `read_messages` tool alone does not turn the inbox into tasks; that needs polling.

## Replying to an incoming message and the durable outbox

The `inbound` hook receives an optional fifth `{connectorId,replyTarget}` context argument and returns `{task:{id}}`. The service binds the task id, encrypted, to the original provider channel. For a completed task the runtime calls `enqueueReply(taskId, text)`; a repeated completion notice for the same task does not create a new send. A Slack DM/mention reply goes to the original channel and thread; a Teams reply goes to the service URL and conversation verified with the JWT; an email reply goes to the exactly matching `allowedSenders` address with `In-Reply-To`/`References` headers; a generic webhook reply goes as a signed POST containing `inReplyTo` and requestId correlation. If there is no suitable email allowlist for the reply, no automatic reply binding is created.

If the connection has `autoReply:true` **and both the receive and send scopes**, the explicit connection permission is used to reply to this verified binding. Normal `call` operations still use the approval hook. If AutoReply is off, the outbox becomes `approval_required`; the root opens a separate manual runtime task and calls `deliverReply(outboxId)` in that task's context. This call waits for the normal approval hook. Approval cannot bypass the receive/send scope, a disabled connection or the email allowlist check.

`listOutbox()` returns `{id,connectorId,taskId,status,attempts,lastError,createdAt,updatedAt}` without revealing target, text or credentials. `getReplyRequest(id)` reveals the target and text only so the server can prepare the approval text; it is not added to the public connector list. Root admin API: GET `/api/v1/connectors/outbox`, POST `/api/v1/connectors/outbox/:id/retry`. A retry also creates a separate runtime approval task. The status values are `pending`, `approval_required`, `sending`, `sent`, `failed`, `delivery_unknown`.

The outbox send request and the channel binding are stored encrypted in SQLite. The timer processes only `pending` work that has not been tried yet; `failed` or `delivery_unknown` is not resent on its own. If the process stops during `sending`, the status becomes `delivery_unknown` after restart. HTTP/provider protocols give no global exactly-once delivery guarantee; when a connection fails, the provider may already have received the message. Check at the provider before retrying. An outbox item successfully marked `sent` is never sent again. If a manual approval is pending at shutdown, wait for the integration.stop Promise after ending the approval waiters with runtime.stop.

## Slack

Example config fields: `botToken`, `signingSecret`, `dotId`, preferably `teamId`; `apiUrl` is customized only for a proxy or a local contract test and defaults to `https://slack.com/api/`.

The local scopes are `events:read`, `history:read` and `chat:write`. They are not an exact copy of Slack's OAuth scopes: in the Slack app you additionally need `chat:write`, a history scope suited to the target conversation type (`im:history`, `channels:history` and so on) and `app_mentions:read` for mentions. Enable the Events API, register your webhook URL, subscribe to the `message.im` and `app_mention` events and add the bot to the conversations it needs. The URL verification challenge is answered after the signature is verified. Only DM and bot mention events are accepted as inbound; bot messages and subtype events are ignored.

Tools: `read_messages {channel,limit?}`, `send_message {channel,text,thread_ts?}`. The connection test uses `auth.test`. Restrict the workspace boundary with `teamId`. Slack event repeats are de-duplicated by `event_id`.

Official sources: [request signature and raw body](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [conversation history](https://docs.slack.dev/reference/methods/conversations.history/), [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/).

## Microsoft Teams

Create an Azure Bot / Bot Framework registration and enable the Teams channel. Configure `appId`, `appSecret`, `dotId`, `tenantId` (for a single tenant) and the `serviceUrl` of the conversation to send to. For several service URLs use the `allowedServiceUrls` list of full URLs. The local scopes are `messages:read` and `messages:send`. `tenantId` both restricts the incoming tenant and selects the OAuth tenant; multi-tenant registrations work with the default `botframework.com` endpoint.

An incoming Activity goes through the Bot Framework metadata/JWKS keys for the RS256 signature, the fixed `https://api.botframework.com` issuer, its own app ID audience, `nbf`, `exp`, the `serviceUrl` claim and the `msteams` channel endorsement check. There is no option to turn off JWT verification. The administrator can customize the metadata endpoint as `openIdUrl` and the OAuth endpoint as `tokenUrl` for a proxy or test. The URL of an authenticated Activity is not added to the automatic send allowlist.

`send_message {conversationId,text,serviceUrl?}` makes a real Bot Connector `/v3/conversations/.../activities` call. The test verifies the OAuth client credentials response; the authority to send to a real Teams chat must be verified separately. The Emulator JWT protocol is different; this adapter uses the production Connector JWT protocol.

Official source: [Bot Connector authentication and endorsement verification](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0).

## Email

Config: `dotId`, `from?`, `allowedSenders?: string[]`, `smtp` and `imap`. Each transport has `host`, `port`, `secure`, `user` and either `password` or `accessToken`. TLS is required on a remote mail server (`secure: true`; SMTP 465, IMAP 993 by default). `secure:false` is accepted only for a loopback contract test. TLS certificate checking cannot be turned off.

OAuth access tokens are used with SMTP/IMAP XOAUTH2. For renewal, `oauth: {tokenUrl,clientId,clientSecret?,refreshToken,scope?}` can be given inside the transport. A real refresh-token request is made whenever a connection opens; the refresh token and client secret are also encrypted. Obtaining interactive OAuth consent and scopes from the provider is an administrator's setup step; this service does not produce user account authority on its own. If the provider returns a renewed refresh token, the new token is stored permanently in the same encrypted config. An access token is kept in memory only for the duration of the connection.

The local scopes are `mail:read` and `mail:send`; the tools are `read_messages {afterUid?,limit?}` and `send_message {to,subject,text}`. The test performs both SMTP verify and IMAP NOOP. It sends no real message. The server enables inbound polling with integration.start; the message body is delivered to the runtime as plain text. Building task text from HTML and attachments is not part of this adapter.

Official library sources: [Nodemailer SMTP](https://nodemailer.com/smtp), [Nodemailer OAuth2](https://nodemailer.com/smtp/oauth2), [ImapFlow](https://imapflow.com/docs/).

## MCP/app tools

`config {url,headers?,transport?,readOnlyTools?:string[]}`; the default is Streamable HTTP, and `transport:'sse'` selects the older SSE. The local scopes are `tools:read` and `tools:call`. Headers in the config are stored encrypted and fully masked in the API. An Authorization header can be supplied for a server that needs a token. For reading without approval, the administrator adds only the names of audited read tools to the `readOnlyTools` list; the provider must also announce `readOnlyHint:true` for that tool. There is no interactive MCP OAuth login/redirect flow yet; the administrator provides the access token.

The official TypeScript SDK flow is used for initialization, tool discovery (including pagination) and callTool. The test verifies the connection and the listTools response. Only tools that the provider really returns are shown. Codex/ChatGPT cloud connector permissions are not carried over to these MCP connections automatically; you need independent MCP endpoints that the self-hosted service can reach.

Official source: [MCP client development](https://modelcontextprotocol.io/docs/develop/build-client).

## GitHub

Config `token`, `owner`, `repo` and optional `apiUrl` (GitHub Enterprise or a test). Give the token access only to the repositories and functions that are needed. With the local scope `repo:read` there are `get_repository {}` and `list_issues {}`; with `issues:write` there is the approved `create_issue {title,body?}`. The test makes a real GET to the configured repository. API version `2022-11-28` and a Bearer token are used.

Official source: [GitHub issues REST API](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28).

## Generic signed webhook

Config `signingSecret`, `dotId` for inbound, `url` for outbound and an optional read-only health probe `healthUrl`. The scopes are `webhook:receive` and `webhook:send`. Inbound JSON is `{text,requestId}`.

The header `x-dots-timestamp` is Unix seconds; the `x-dots-signature` value is `sha256=` plus the hex output of HMAC-SHA256(secret, timestamp + '.' + raw body). Signatures are checked with a constant-time comparison. `send {payload: object}` makes a real JSON POST with the same protocol. The provider must answer with JSON. Without a `healthUrl` the test stays only `configured` and says that the connection is not verified; it does not POST a webhook merely to test.

## Voice

GET/PATCH `/api/v1/voice/settings` config fields: `enabled`, `apiUrl` (an OpenAI-compatible `/v1` root; `baseUrl` is accepted as an alias), `apiKey`, `transcriptionModel`, `speechModel`, `realtimeModel`, `voice`, `format` and `language?`. There is no provider connection enabled by default: `enabled:false`. Voice does not work until the administrator supplies a real key and endpoint. For the native voice adapter, `getRealtimeConfiguration()` returns the real key inside the server after the enabled and key checks; it cannot be used in HTTP responses. The default realtime model is `gpt-realtime-1.5`.

`transcribe(bytes, filename?, mimeType?)` sends the real file bytes in a multipart `/audio/transcriptions` request and returns the provider's `text` answer. Uploads up to 25 MiB are accepted. `speak(text, voice?)` makes a real `/audio/speech` request and returns `{audio: Buffer,mimeType}`; the HTTP route must return binary audio. Formats are mp3/wav/opus/aac/flac/pcm; the defaults are gpt-4o-mini-transcribe, gpt-4o-mini-tts and coral/mp3. An empty or JSON audio answer is a failure. The interface must tell the user that the voice is AI generated.

These two HTTP functions are not the native Codex voice/Realtime protocol. Starting voice in the native app, audio chunks/interrupt/call state, the WebRTC/WebSocket handshake and notifications need the gateway's own compatibility layer. This adapter does not claim to open a Realtime session or a native voice call. The native protocol methods must be verified separately in the local version with the root compatibility work.

Official OpenAI Docs sources: [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [text to speech](https://developers.openai.com/api/docs/guides/text-to-speech), [gpt-realtime-1.5](https://developers.openai.com/api/docs/models/gpt-realtime-1.5).

## Verification done and missing live acceptance

`apps/server/test/integration.test.ts` tests Slack, signed webhooks, RSA-signed Teams JWT/JWKS/OAuth, GitHub and OpenAI-compatible audio requests against real loopback HTTP servers. The MCP test connects to the official SDK's real Streamable HTTP server. `integration-email.test.ts` tests real auth, message read, the UID cursor, exact sender filter, SMTP DATA, XOAUTH2, HTTP refresh-token rotation and the periodic polling flow with controlled loopback SMTP and IMAP servers. Raw body changes, invalid/expired signatures and JWTs, missing scopes, a refused send approval, redaction and provider error cases are also covered. The reply tests verify the Slack thread, the JWT-verified Teams conversation, SMTP In-Reply-To, signed webhook correlation, de-duplication of repeated completion and restart, and the failed/unknown outbox states on controlled provider protocols.

A live Slack workspace, Teams tenant/conversation, email account, GitHub repository, user MCP server and real audio provider keys were not provided in this work. No live sends to these accounts were made. Controlled-server tests do not replace access permission to these providers or live account acceptance. After setup, authority/scope verification for each account and a send acceptance to a target explicitly approved by the user must still be completed.

### Setup and acceptance status manifest

This table is documentation evidence; it adds no account, message or fake connection record to the runtime. Because the user deferred the account keys, all external provider acceptance remains open.

| Provider | Local contract evidence | Live account setup | Pending live acceptance |
| --- | --- | --- | --- |
| Slack | Signed raw-body/timestamp, real HTTP auth/history/send and thread reply check | The user must provide a bot token + signing secret + workspace/event scopes | Token scopes, DM/mention subscription, an approved test target |
| Teams | Real RSA JWT/JWKS/OAuth and a same-conversation reply HTTP check | The user must set up an Azure Bot app/tenant + the Teams channel | Tenant token, endorsement and real conversation authority |
| Email | Local SMTP/IMAP DATA, XOAUTH2, refresh-token rotation, cursor, sender filter/reply header | The user must provide SMTP/IMAP or consent/refresh credentials | Account TLS/auth, real mailbox UID behaviour and an approved recipient |
| MCP | The official SDK's Streamable HTTP initialize/list/call response and an explicit readOnly grant | The user must provide a real MCP URL/auth/read allowlist | Real server tools, scope and the native approval UI flow |
| GitHub | Local REST repository/issues and Bearer header check | The user must provide a repository + the required fine-grained token | Real repository permissions and an explicitly approved issue target |
| Signed webhook | HMAC, timestamp, retry receipt, correlation and real POST bytes | The user must provide an endpoint/shared secret/health URL | Real receiver signature verification and a provider receipt |
| STT/TTS | Local HTTP multipart file, a real audio buffer and a provider error check | The user must provide voice endpoint/key/model access | Real speech recognition/generation; listening quality |
| Realtime voice | In-server encrypted key decryption; the coverage of the separate native voice test files | The user must provide an endpoint/key with Realtime access | Native WebRTC microphone/speaker and real call acceptance |

`connected` is evidence of a successful connection probe only. The local tool scope list does not widen even after a connection test; a missing scope is refused before the call. It does not mean the account was verified to reach every conversation, recipient or write endpoint. If the provider probe returns `missing_scope` or an auth error, the status is not made `connected`.

Worker managed app-server local evidence: `apps/worker/test/managed-appserver.test.ts` verifies private config/env, token redaction, owned-child lifecycle, timeout and the behaviour of not shutting down the user's server, with a controlled Node child. With the installed `codex-cli 0.159.2`, a real private child `--listen ws://127.0.0.1:0` startup smoke test got 200 from `/healthz` and `/readyz`, and the child was shut down. No model inference was done in this test. The worker provider URL is `${server}/worker/model`; the token is `DOTS_WORKER_TOKEN` in the child environment only. The main Codex config/home is not used. Cloud apps/plugins/analytics are off in the private config. If the CLI is missing it does not do a global install; an installed CLI via `DOTS_CODEX_CLI` or on PATH is required. That the WebSocket app-server protocol is experimental is stated in the [official Codex App Server document](https://learn.chatgpt.com/docs/app-server); [Responses provider/env_key setup](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) explains provider token passing.
