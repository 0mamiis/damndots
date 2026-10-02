# Gerçek bağlantılar ve ses

Bağlantılar servis tarafında çalışır. Dashboard'da oluşturulan bağlantının `configured` olması hesap bağlantısının doğrulandığı anlamına gelmez. `POST /api/v1/connectors/:id/test` gerçek sağlayıcı isteği gerçekleştirir; yalnız başarılı sağlayıcı cevabı `connected` durumunu üretir. Eksik alanlar `needs_configuration`, sağlayıcı hatası `error` olur. Bir bağlantının sağlıklı olması sağladığınız token'ın her API kapsamına sahip olduğunu garanti etmez; kapsam hataları gerçek çağrıda döner.

`IntegrationService` yapılandırmayı SQLite'a AES-256-GCM ile şifrelenmiş olarak yazar. `encryptionKey` 32 byte Buffer veya bunun base64 karşılığıdır. Üretimde bu anahtarı ortam sırrında tutun, veri yedeğiyle birlikte güvenli biçimde saklayın; anahtar kaybolursa yapılandırma geri çözülemez. Servis bir rastgele geçici anahtarla başlamamalıdır. API cevaplarında `token`, `secret`, `password`, `apiKey`, `authorization`, `headers`, `credential` alanları maskelenir. PATCH nesneleri birleştirir; `[redacted]` değeri eski sırrı korur, `null` sırrı kaldırır. Düzenlemeler bağlantıyı yeniden `configured` durumuna geçirir.

Gönderme ve yazma araçları `authorizeSend(connector, toolName, arguments)` onay kancasını bekler. Kanca yoksa veya reddederse sağlayıcıya yazma isteği gitmez. Gelen mesaja kendi doğrulanmış kanalında cevap için ayrıca açık `autoReply:true` bağlantı izni verilebilir; bu izin normal araç gönderimlerine yayılmaz. Slack geçmiş okuma, IMAP okuma ve GitHub okuma ayrı kapsamlarla açılır. MCP `readOnlyHint: true` ilan eden araç **ayrıca** bağlantı yöneticisinin `config.readOnlyTools` listesinde olmalıdır; aksi durumda onay ister. Sağlayıcının annotation/hint'i yetki vermez. `call(..., {readOnly:true})` yalnız açık okuma yetkisi verilen araçları çalıştırır; proactive task bunu kullanmalıdır. `isReadOnlyTool(id,name)` native tool listesine gerçek politika bilgisini aktarır. Uzak HTTP sağlayıcıları HTTPS ister; localhost kontrollü test ve yerel servis için HTTP kabul edilir. Authorization taşıyan HTTP istekleri yönlendirme izlemez; MCP SDK bağlantıları yapılandırılan origin dışına çıkamaz. URL query alanlarında token/secret kullanılamaz; bunları ayrı secret/header alanlarında sağlayın.

## HTTP ve runtime bağlantısı

Admin CRUD/test/tools/call endpointleri [ARCHITECTURE.md](./ARCHITECTURE.md) içindeki sözleşmeyi kullanır. Provider webhook URL'si `/integrations/:id/webhook`; root server'ın bağladığı `IntegrationService.webhook(id, headers, rawBody: Buffer)` metoduna **aynen alınan baytlarla** gider. JSON'u parse edip tekrar serialize etmek imzayı bozar. Webhook endpointi dashboard oturum token'ı istemez; sağlayıcı imzası/JWT ile doğrulanır. Raw body en fazla 1 MiB'dır.

Yapılandırmadaki `dotId`, gelen mesajın hangi Dot'a teslim edileceğini seçer. Servis `inbound(dotId, text, channel, requestId)` çağırır. `requestId` bağlantı kimliğiyle öneklenir; başarılı teslim SQLite'ta kaydedilir, aynı olayın paralel veya yeniden başlatma sonrası tekrarları teslim edilmez. Runtime da requestId'yi korumalıdır: teslim başarılı olup receipt yazılmadan süreç durursa runtime tekrarını kendi mesaj idempotency kontrolü karşılar. Hatalı teslim receipt oluşturmaz ve tekrar denenebilir. Slack ve genel webhook imzasında zaman penceresi 300 saniyedir; makinelerin saatini eşitleyin.

`pollEmail(id)` IMAP mesajlarını kalıcı UID/UIDVALIDITY cursor ile okur ve aynı inbound kancasına gönderir. `start({emailPollMs?,outboxRetryMs?})` enabled email bağlantılarını varsayılan 30 saniyede, aynı bağlantı için üst üste binmeden poll eder. `stop()` timer'ları kaldırıp süren işleri bekler. Admin `/api/v1/connectors/:id/poll` endpointi aynı poll'u elle tetikler; periyodik poll ile çakışırsa aynı Promise'i bekler. Bir çağrı en fazla 100 mesaj alır; sonraki çağrı cursor'dan devam eder. UIDVALIDITY değiştiğinde yeni posta kutusu sıralaması baştan okunur. İzinli gönderici denetimi parse edilen gerçek adresle tam eşleşir. `read_messages` aracı tek başına inbox'u göreve dönüştürmez; bunun için polling gerekir.

## Gelen mesaja cevap ve kalıcı outbox

`inbound` kancası opsiyonel beşinci `{connectorId,replyTarget}` context argümanını alır ve `{task:{id}}` döndürür. Servis task kimliğini orijinal provider kanalına şifrelenmiş olarak bağlar. Runtime tamamlanan task için `enqueueReply(taskId, text)` çağırır; aynı task'ın tekrar completion bildirimi yeni gönderim oluşturmaz. Slack DM/mention cevabı orijinal channel ve thread'e; Teams cevabı JWT ile doğrulanmış service URL ve conversation'a; email cevabı tam eşleşen `allowedSenders` adresine, `In-Reply-To`/`References` header'larıyla; generic webhook cevabı `inReplyTo` ve requestId korelasyonu içeren signed POST ile gider. Reply için uygun email allowlist yoksa otomatik reply binding oluşturulmaz.

Bağlantıda `autoReply:true` **ve hem receive hem send kapsamı** varsa bu doğrulanmış binding'e cevap vermek için açık bağlantı izni kullanılır. Normal `call` işlemleri hâlâ onay kancasını kullanır. AutoReply kapalıysa outbox `approval_required` olur; root ayrı bir manual runtime task açar ve o task bağlamında `deliverReply(outboxId)` çağırır. Bu çağrı normal approval kancasını bekler. Receive/send kapsamı, devre dışı bağlantı veya email allowlist denetimi approval ile atlanamaz.

`listOutbox()` hedef/metin/kimlik bilgilerini açmadan `{id,connectorId,taskId,status,attempts,lastError,createdAt,updatedAt}` döndürür. `getReplyRequest(id)` yalnız server'ın approval metni hazırlaması için hedef ve metni açar; public connector listesine eklenmez. Root admin API: GET `/api/v1/connectors/outbox`, POST `/api/v1/connectors/outbox/:id/retry`. Retry de ayrı runtime onay görevi oluşturur. Status değerleri `pending`, `approval_required`, `sending`, `sent`, `failed`, `delivery_unknown`.

Outbox gönderim isteği ve channel binding SQLite'ta encrypted saklanır. Timer yalnız henüz denenmemiş `pending` işi işler; `failed` veya `delivery_unknown` kendiliğinden tekrar gönderilmez. Süreç `sending` sırasında kapanırsa yeniden başlatmada durum `delivery_unknown` olur. HTTP/provider protokolleri global exactly-once teslim garantisi sağlamaz; bağlantı hata verdiğinde sağlayıcı mesajı almış olabilir. Retry öncesi sağlayıcıda kontrol edin. Başarıyla `sent` işaretlenen outbox tekrar gönderilmez. Kapanışta manual approval bekleniyorsa runtime.stop ile onay bekleyicilerini sonlandırdıktan sonra integration.stop Promise'ini bekleyin.

## Slack

Örnek config alanları: `botToken`, `signingSecret`, `dotId`, tercihen `teamId`; `apiUrl` yalnız proxy veya yerel sözleşme testi için özelleştirilir, varsayılan `https://slack.com/api/`.

Yerel kapsamlar `events:read`, `history:read`, `chat:write`'tır. Bunlar Slack OAuth kapsamlarıyla birebir aynı liste değildir: Slack uygulamasında ayrıca `chat:write`, hedef sohbet türüne uygun history kapsamı (`im:history`, `channels:history` vb.), mention için `app_mentions:read` gereklidir. Events API'yi açın, webhook URL'nizi kaydedin, `message.im` ve `app_mention` olaylarını abone edin; bot'u gerekli konuşmalara ekleyin. URL verification challenge imza doğrulandıktan sonra cevaplanır. Yalnız DM ve bot mention olayları inbound'a alınır; bot mesajları ve subtype olayları yok sayılır.

Araçlar: `read_messages {channel,limit?}`, `send_message {channel,text,thread_ts?}`. Bağlantı testi `auth.test` kullanır. Workspace sınırını `teamId` ile kısıtlayın. Slack event tekrarları `event_id` ile tekilleştirilir.

Resmî kaynaklar: [istek imzası ve ham gövde](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [conversation history](https://docs.slack.dev/reference/methods/conversations.history/), [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/).

## Microsoft Teams

Azure Bot / Bot Framework kaydı oluşturup Teams channel'ı etkinleştirin. `appId`, `appSecret`, `dotId`, `tenantId` (tek tenant için) ve gönderilecek konuşmanın `serviceUrl` değerini yapılandırın. Birden fazla service URL için `allowedServiceUrls` tam URL listesi kullanılır. Yerel kapsamlar `messages:read` ve `messages:send`'tir. `tenantId` hem gelen tenant'ı sınırlar hem OAuth tenant'ını seçer; çok tenantlı kayıtlar varsayılan `botframework.com` uç noktasıyla çalışır.

Gelen Activity, Bot Framework metadata/JWKS anahtarlarıyla RS256 imza, sabit `https://api.botframework.com` issuer, kendi app ID audience, `nbf`, `exp`, `serviceUrl` claim ve `msteams` channel endorsement kontrolünden geçer. JWT doğrulamasını kapatan seçenek yoktur. Metadata endpointi `openIdUrl`, OAuth endpointi `tokenUrl` olarak yönetici tarafından proxy/test için özelleştirilebilir. Kimliği doğrulanmış Activity'nin URL'si otomatik gönderme allowlist'ine eklenmez.

`send_message {conversationId,text,serviceUrl?}` gerçek Bot Connector `/v3/conversations/.../activities` çağrısı yapar. Test OAuth client credentials cevabını doğrular; gerçek Teams sohbetine gönderim yetkisi ayrıca doğrulanmalıdır. Emulator JWT protokolü farklıdır; bu adapter production Connector JWT protokolünü kullanır.

Resmî kaynak: [Bot Connector authentication ve endorsement doğrulaması](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0).

## Email

Config: `dotId`, `from?`, `allowedSenders?: string[]`, `smtp` ve `imap`. Her transport'ta `host`, `port`, `secure`, `user` ve `password` ya da `accessToken` bulunur. Uzak mail sunucusunda TLS zorunludur (`secure: true`; SMTP 465, IMAP 993 varsayılan). `secure:false` yalnız loopback sözleşme testi için kabul edilir. TLS sertifika denetimi kapatılamaz.

OAuth access token'lar SMTP/IMAP XOAUTH2 ile kullanılır. Yenileme için ilgili transport içinde `oauth: {tokenUrl,clientId,clientSecret?,refreshToken,scope?}` verilebilir. Her bağlantı açılırken gerçek refresh-token isteği yapılır; refresh token ve client secret da şifrelenir. Sağlayıcıdan interaktif OAuth consent ve kapsamları almak yöneticinin kurulum adımıdır; bu servis kullanıcı hesabı yetkisini kendiliğinden üretmez. Sağlayıcı yenilenmiş refresh token döndürürse yeni token aynı encrypted config içinde kalıcı olarak saklanır. Access token yalnız bağlantı süresince bellekte tutulur.

Yerel kapsamlar `mail:read` ve `mail:send`; araçlar `read_messages {afterUid?,limit?}` ve `send_message {to,subject,text}`. Test hem SMTP verify hem IMAP NOOP gerçekleştirir. Gerçek mesaj göndermez. Server integration.start ile inbound polling'i açar; mesaj gövdesi plain text olarak runtime'a teslim edilir. HTML ve attachment'dan görev metni oluşturma bu adapter'a dahil değildir.

Resmî kütüphane kaynakları: [Nodemailer SMTP](https://nodemailer.com/smtp), [Nodemailer OAuth2](https://nodemailer.com/smtp/oauth2), [ImapFlow](https://imapflow.com/docs/).

## MCP/app araçları

`config {url,headers?,transport?,readOnlyTools?:string[]}`; varsayılan Streamable HTTP, eski SSE için `transport:'sse'`. Yerel kapsamlar `tools:read`, `tools:call`. Config'deki headers encrypted olarak saklanır ve API'de tamamı maskelenir. Token gerektiren server için Authorization header sağlanabilir. Onaysız okuma için yönetici yalnız denetlenmiş okuma araçlarının isimlerini `readOnlyTools` listesine ekler; sağlayıcı da bu araçta `readOnlyHint:true` bildirmelidir. İnteraktif MCP OAuth login/redirect akışı henüz yoktur; yönetici erişim token'ını sağlar.

Resmî TypeScript SDK initialization, araç keşfi (sayfalama dahil) ve callTool akışını kullanır. Test bağlantıyı ve listTools cevabını doğrular. Yalnız sağlayıcının gerçekten döndürdüğü araçlar görünür. Codex/ChatGPT bulut connector izinleri bu MCP bağlantılarıyla otomatik taşınmaz; selfhosted servisin erişebildiği bağımsız MCP endpointleri gerekir.

Resmî kaynak: [MCP client geliştirme](https://modelcontextprotocol.io/docs/develop/build-client).

## GitHub

Config `token`, `owner`, `repo`, opsiyonel `apiUrl` (GitHub Enterprise veya test). Token'ın yalnız gerekli repository ve işlevlere erişimini verin. Yerel kapsam `repo:read` ile `get_repository {}` ve `list_issues {}`; `issues:write` ile onaylı `create_issue {title,body?}`. Test configured repository'ye gerçek GET yapar. API version `2022-11-28` ve Bearer token kullanılır.

Resmî kaynak: [GitHub issues REST API](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28).

## Genel imzalı webhook

Config `signingSecret`, inbound için `dotId`, outbound için `url`, isteğe bağlı yalnız okuma health probe için `healthUrl`. Kapsamlar `webhook:receive`, `webhook:send`. Inbound JSON `{text,requestId}`.

Header `x-dots-timestamp` Unix saniyesi; `x-dots-signature` değeri `sha256=` + HMAC-SHA256(secret, timestamp + '.' + ham gövde) hex çıktısıdır. İmzalar sabit zaman karşılaştırmasıyla kontrol edilir. `send {payload: object}` aynı protokolle gerçek JSON POST yapar. Sağlayıcı JSON cevap vermelidir. Test `healthUrl` yoksa yalnız `configured` kalır ve bağlantının doğrulanmadığını söyler; doğrulama için sırf test amacıyla webhook POST etmez.

## Ses

GET/PATCH `/api/v1/voice/settings` config alanları: `enabled`, `apiUrl` (OpenAI uyumlu `/v1` kökü; `baseUrl` alias kabul edilir), `apiKey`, `transcriptionModel`, `speechModel`, `realtimeModel`, `voice`, `format`, `language?`. Varsayılan açık bir sağlayıcı bağlantısı değildir: `enabled:false`. Yönetici gerçek anahtar ve endpoint sağlamadan ses çalışmaz. Native voice adapter'ı için `getRealtimeConfiguration()` enabled ve key kontrolünden sonra server içinde gerçek key'i döndürür; HTTP cevaplarında kullanılamaz. Realtime model varsayılanı `gpt-realtime-1.5`.

`transcribe(bytes, filename?, mimeType?)` gerçek file baytlarını multipart `/audio/transcriptions` isteğinde gönderir ve sağlayıcının `text` cevabını döner. En fazla 25 MiB yükleme kabul edilir. `speak(text, voice?)` gerçek `/audio/speech` isteği yapar ve `{audio: Buffer,mimeType}` döner; HTTP route binary audio vermelidir. Formatlar mp3/wav/opus/aac/flac/pcm; varsayılan gpt-4o-mini-transcribe, gpt-4o-mini-tts, coral/mp3. Boş veya JSON ses cevabı başarısızdır. Arayüz kullanıcıya sesin AI ile üretildiğini belirtmelidir.

Bu iki HTTP işlevi native Codex voice/Realtime protokolü değildir. Native app'deki voice başlatma, ses parçaları/interrupt/call state, WebRTC/WebSocket handshake ve notifications için gateway'in kendi compatibility katmanı gerekir. Bu adapter Realtime session ya da native voice call açtığını iddia etmez. Native protokol yöntemleri yerel sürümde root uyumluluk çalışmasıyla ayrıca doğrulanmalıdır.

Resmî OpenAI Docs kaynakları: [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [text to speech](https://developers.openai.com/api/docs/guides/text-to-speech), [gpt-realtime-1.5](https://developers.openai.com/api/docs/models/gpt-realtime-1.5).

## Yapılan doğrulama ve eksik canlı kabul

`apps/server/test/integration.test.ts` gerçek loopback HTTP sunucularıyla Slack, signed webhooks, RSA imzalı Teams JWT/JWKS/OAuth, GitHub ve OpenAI uyumlu audio isteklerini test eder. MCP testi resmî SDK'nın gerçek Streamable HTTP server'ına bağlanır. `integration-email.test.ts` kontrollü loopback SMTP ve IMAP sunucularıyla gerçek auth, message read, UID cursor, exact sender filter, SMTP DATA, XOAUTH2, HTTP refresh-token rotasyonu ve periodic polling akışını test eder. Ham gövde değişiklikleri, geçersiz/expired imza/JWT, eksik kapsamlar, reddedilen gönderim onayı, redaction ve provider hata durumları da kapsanır. Cevap testleri Slack thread, JWT ile doğrulanmış Teams conversation, SMTP In-Reply-To, signed webhook korelasyonu, tekrar completion/restart tekilleştirme ve failed/unknown outbox durumlarını kontrollü sağlayıcı protokollerinde doğrular.

Canlı Slack workspace, Teams tenant/conversation, email hesabı, GitHub repository, kullanıcı MCP server'ı ve gerçek audio provider anahtarları bu uygulama çalışmasında sağlanmadı. Bu hesaplara canlı gönderim yapılmadı. Controlled-server testleri bu sağlayıcılara erişim izni veya canlı hesap kabulü yerine geçmez. Kurulum sonrası her hesap için yetki/kapsam doğrulaması ve kullanıcı tarafından açıkça onaylanmış hedefe gönderim kabulü hâlâ tamamlanmalıdır.

### Kurulum/kabul durum manifesti

Bu tablo dokümantasyon kanıtıdır; runtime'a hesap, mesaj veya sahte bağlantı kaydı eklemez. Hesap anahtarları kullanıcı tarafından ertelendiği için bütün dış sağlayıcı kabulü açık kalır.

| Sağlayıcı | Yerel sözleşme kanıtı | Canlı hesap kurulumu | Bekleyen canlı kabul |
| --- | --- | --- | --- |
| Slack | Signed raw-body/timestamp, gerçek HTTP auth/history/send ve thread reply kontrolü | Kullanıcı bot token + signing secret + workspace/event scopes vermeli | Token kapsamı, DM/mention subscription, onaylı test hedefi |
| Teams | Gerçek RSA JWT/JWKS/OAuth ve aynı conversation reply HTTP kontrolü | Kullanıcı Azure Bot app/tenant + Teams channel kurmalı | Tenant token, endorsement ve gerçek conversation yetkisi |
| Email | Yerel SMTP/IMAP DATA, XOAUTH2, refresh-token rotation, cursor, sender filter/reply header | Kullanıcı SMTP/IMAP veya consent/refresh credentials sağlamalı | Hesap TLS/auth, gerçek mailbox UID davranışı ve onaylı alıcı |
| MCP | Resmî SDK'nın Streamable HTTP initialize/list/call cevabı ve explicit readOnly grant | Kullanıcı gerçek MCP URL/auth/okuma allowlist sağlamalı | Gerçek server araçları, scope ve native approval UI akışı |
| GitHub | Yerel REST repository/issues ve Bearer header kontrolü | Kullanıcı repository + gerekli fine-grained token sağlamalı | Gerçek repo yetkileri ve açıkça onaylanmış issue hedefi |
| Signed webhook | HMAC, timestamp, retry receipt, korelasyon ve gerçek POST baytları | Kullanıcı endpoint/shared secret/health URL sağlamalı | Gerçek receiver imza doğrulaması ve provider receipt |
| STT/TTS | Yerel HTTP multipart file, gerçek audio buffer ve sağlayıcı hata kontrolü | Kullanıcı ses endpoint/key/model erişimi sağlamalı | Gerçek ses çözümleme/üretim; dinleme kalitesi |
| Realtime voice | Server içi şifreli key çözme; native voice ayrı test dosyalarının kapsamı | Kullanıcı Realtime erişimli endpoint/key sağlamalı | Native WebRTC mikrofon/speaker ve gerçek çağrı kabulü |

`connected` yalnız başarılı bağlantı probe'unun kanıtıdır. Yerel tool scope listesi bağlantı testinden sonra bile genişlemez; eksik scope çağrı öncesi reddedilir. Hesabın her conversation, recipient veya write endpoint'ine erişiminin doğrulandığı anlamına gelmez. Sağlayıcı probe `missing_scope` veya auth hata cevabı verirse `connected` yapılmaz.

Worker managed app-server yerel kanıtı: `apps/worker/test/managed-appserver.test.ts` kontrollü Node child ile private config/env, token redaction, owned-child lifecycle, timeout ve kullanıcı sunucusunu kapatmama davranışını doğrular. Kurulu `codex-cli 0.159.2` ile gerçek private child `--listen ws://127.0.0.1:0` startup smoke testinde `/healthz` ve `/readyz` 200 alındı, child kapatıldı. Bu testte model inference yapılmadı. Worker provider URL'si `${server}/worker/model`; token yalnız child env'de `DOTS_WORKER_TOKEN`. Ana Codex config/home kullanılmaz. Cloud apps/plugins/analytics private config'te kapalıdır. CLI yoksa global kurulum yapmaz; `DOTS_CODEX_CLI` veya PATH üzerindeki kurulu CLI gerekir. WebSocket app-server protokolünün experimental olduğu [resmî Codex App Server dokümanında](https://learn.chatgpt.com/docs/app-server) belirtilir; [Responses provider/env_key kurulumu](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) provider token aktarımını açıklar.
