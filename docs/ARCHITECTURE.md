# Dots self-hosted hedefi ve sözleşme

Tam kapsam: native Codex Your Dot uyumluluğu; gerçek görev kuyruğu, duraklatma/iptal, Activity ve Outputs; kalıcı hafıza; zamanlama ve proaktif araştırma; görev delegasyonu; bilgisayar ve tarayıcı yürütücüsü; Slack/Teams/email bağlantıları, genel app/MCP araçları ve ses; Next.js + HeroUI dashboard; aynı PC veya uzak server kurulumu; mevcut veriyi taşıma; yeniden başlatma ve sürüm uyumluluğu.

Bu uygulama kendi servislerini sağlar. OpenAI'nin bulut servis yetkilerini oluşturmaz. Ana Codex profiliyle açılış yedekli ve geri alınabilir bir başlatıcıyla yapılır (docs/MAIN-CODEX.md).

## Paketler ve sahiplik

- apps/server: Fastify API, SQLite storage, runtime, Codex protocol bridge ve integrations.
- apps/dashboard: Next.js App Router + HeroUI v3 + Tailwind v4. Türkçe yönetim arayüzü. Gerçek server API; boş sonuçları gösterir.
- apps/worker: server'a dışarı doğru bağlanan bağımsız bilgisayar/tarayıcı yürütücüsü. Server ile aynı makinede başlatılabilir.
- apps/client: native Codex için yerel gateway, Windows MSIX bağlantısı ve eski izole profil uyumluluğu. Server localhost veya uzak adreste olabilir.
- packages/contracts: paylaşılan TypeScript DTO'lar.

## HTTP admin API

Prefix `/api/v1`. Admin bootstrap token yalnız POST `/api/v1/session` isteğinde `{token}` gövdesiyle kullanılır. Başarılı cevap `{accessToken,expiresAt}`. Diğer API istekleri `Authorization: Bearer <accessToken>` ister. Dashboard kendi BFF'sinde bu token ve server URL'sini HttpOnly cookie'de tutar; provider sırları liste cevaplarında verilmez.

GET `/overview` -> Overview; GET/PATCH `/settings` -> Settings.
GET `/dots` -> ApiList<Dot>; POST `/dots` {name,model?,instructions?,computerId?}; GET/PATCH/DELETE `/dots/:id`.
POST `/dots/:id/pause`, `/resume`; GET `/dots/:id/messages` -> ApiList<Message>; POST same SubmitMessage -> {message,task}.
GET `/tasks?dotId=&status=` -> ApiList<Task>; POST `/tasks` CreateTask; GET `/tasks/:id`; POST `/tasks/:id/cancel`, `/retry`, `/delegate` {title,input,computerId?}.
GET `/activity?dotId=&taskId=` -> ApiList<Activity>.
GET `/outputs?dotId=&taskId=` -> ApiList<Output>; GET `/outputs/:id/content` binary; POST `/dots/:id/attachments` multipart -> Attachment.
GET `/memories?dotId=` -> ApiList<Memory>; POST `/memories` {dotId,title,content,tags?}; PATCH/DELETE `/memories/:id`.
GET `/schedules?dotId=` -> ApiList<Schedule>; POST `/schedules` fields; PATCH/DELETE `/schedules/:id`; POST `/schedules/:id/run` -> Task.
GET `/approvals` -> ApiList<Approval>; POST `/approvals/:id/resolve` {approved:boolean}.
GET `/computers` -> ApiList<Computer>; POST `/computers/enrollment` {name?} -> {token,expiresAt,command}; DELETE `/computers/:id` revokes key.
POST `/computers/:id/browser` {action,...} queues a browser job; GET `/browser/jobs/:id` polls result including screenshot URL if available.
GET `/connectors` -> ApiList<Connector>; POST `/connectors` {kind,name,config,scopes?,enabled?}; PATCH/DELETE `/connectors/:id`; POST `/connectors/:id/test`; GET `/connectors/:id/tools`; POST `/connectors/:id/tools/:name/call` {arguments}. Secrets accepted on create/edit but always redacted on read.
POST `/voice/transcribe` multipart audio -> {text}; POST `/voice/speak` {text,voice?} -> audio; GET/PATCH `/voice/settings` redacted settings.
GET `/events` authenticated SSE RuntimeEvent, with Last-Event-ID replay.

## Runtime interface

`OrbitRuntime(store, runner, options)` implements start/stop, get/list/create/update/deleteDot, submitMessage, listMessages, pauseDot/resumeDot, create/get/list/cancel/retry/delegateTask, listActivity, list/get/registerOutput, list/create/update/deleteMemory, list/create/update/delete/runSchedule, list/resolveApproval, event subscribe/replay.
Store implements RecordStore. Runner implements TaskRunner and must interrupt actual upstream work on abort. Keep messages queued rather than dropping a busy room; duplicate requestId must return original submission. Pausing aborts active turn and preserves task as paused, resuming schedules it. Activities and outputs record actual events.
Use an injectable clock for scheduler tests; SQLite persistence is authoritative. No fake computers, artifacts, or completed work.

## Worker interface (root agent owns implementation)

Enrollment token single-use; worker receives per-computer token. `/worker/register` {token,name,platform,roots,capabilities} -> {computerId,token}; POST `/worker/heartbeat`; GET `/worker/jobs/next` -> job or 204; POST `/worker/jobs/:id/result` result or error. Jobs leased; heartbeat keeps lease; revoke invalidates all worker access. Kind codex-rpc (request/notification support via worker RPC channel), filesystem or browser. Browser sessions are persistent isolated Playwright contexts; screenshot and Take over controls are usable through dashboard. Workspace roots are explicit; reject traversal and symlink escapes.

## Integration interface (integration agent owns implementation)

`IntegrationService(store, options)` CRUD/test/tools/call, inbound webhook handling and voice config/transcribe/speak. Options provide emit, inbound(dotId,text,channel,requestId), authorizeSend (approval hook), storage secret encryption key. No live messages to external recipients during implementation/tests. Read scopes and send scopes separate. Slack signatures + replay window, Teams JWT validation, email SMTP+IMAP/OAuth, generic MCP tools with configurable auth, GitHub API tools, generic signed webhook. Use real adapters and contract tests against controlled local servers; missing credentials show needs_configuration, never connected. Document external setup.

## Deployment and acceptance

Same-PC run: server + dashboard + optional worker + native local gateway. Remote: server/dashboard elsewhere, local gateway + worker outbound authentication; TLS for non-loopback traffic, or SSH tunnel. No hard requirement for VPS.
Acceptance must include queue/cancel/pause/restart/scheduling/delegation/memory/artifacts tests, full authenticated dashboard mutations, genuine local Codex turn & output, browser worker screenshot/action test, native profile compatibility, same-PC startup and remote-address configuration. External provider/account tests require actual user setup; unavailable credentials remain explicit unfinished verification, not success.
