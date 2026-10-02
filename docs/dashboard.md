# Dots paneli

Panel, Next.js 16 ve **HeroUI v3** (React Aria + Tailwind CSS v4) ile yazılmıştır. Özel bileşen CSS'i yoktur; görünüm HeroUI bileşenleri, HeroUI tasarım değişkenleri ve Tailwind sınıflarından oluşur. `apps/dashboard/app/globals.css` yalnız marka rengini (`--accent`) ve kontrast için `--muted/--success/--warning/--danger` değerlerini ayarlar.

## Çalıştırma

```powershell
npm run build --workspace @dots/dashboard
npm run start --workspace @dots/dashboard -- --port 4320
```

Dots yerel yığını paneli otomatik başlatır (varsayılan: http://127.0.0.1:4320). Giriş için sunucunun yönetici erişim anahtarı gerekir (`apps/server/.data/server/admin.key`).

## Başkalarına açarken

Panel, giriş formundaki sunucu adresine sunucu tarafından istek atar. Panele başka insanlar erişebiliyorsa bu, panelin kendi ağındaki adreslere istek atmasına yol açar. Bu yüzden yayınlarken izin verilen sunucuyu sabitle:

| Değişken | Anlamı |
| --- | --- |
| `DOTS_SERVER_URL` | Panelin bağlanabileceği tek Dots sunucusu; form bu adresle dolar. |
| `DOTS_ALLOWED_SERVERS` | Virgülle ayrılmış birden fazla izinli sunucu. |
| `DOTS_DASHBOARD_HOST`, `DOTS_DASHBOARD_PORT` | Dinlenen adres ve port (varsayılan 127.0.0.1:3000; `--port` ile de verilebilir). |

Uzak sunucular HTTPS gerektirir; yalnız localhost HTTP olabilir. Panelin önüne TLS sonlandıran bir ters vekil koy ve `X-Forwarded-Proto: https` ilet; oturum çerezi o zaman `Secure` olur. Çerezler `HttpOnly` ve `SameSite=Strict` ayarlıdır, değiştirici isteklerde kaynak denetimi yapılır. Yanıtlarda `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` ve `Permissions-Policy` başlıkları vardır.

## Arayüz

- Açık ve koyu tema (sistem tercihi, üst çubuktan değiştirilir, tercih saklanır).
- Mobilde menü HeroUI Drawer ile açılır; sayfa adresin `#bölüm` kısmında saklanır, yenileyince aynı bölümde kalırsın.
- Kaydedilen değişiklikler HeroUI Toast ile bildirilir; hatalar formun altında Alert olarak görünür.
- Ses ayarlarında “Aramalarda Codex’te seçili sesi kullan” anahtarı vardır.

## Doğrulama

`npm run test --workspace @dots/dashboard` oturum ve izin listesi kurallarını sınar. Arayüz etkileşimleri (model/düşünme/hızlı mod, anahtarlar, seçim kutuları, zorunlu alanlar, bildirim, yenilemede bölüm korunması) ve axe erişilebilirlik taraması gerçek tarayıcıda çalıştırıldı. Taramada kalan tek bulgu, React Aria'nın kendi ekran okuyucu duyuru kabıdır (`role=img`); kütüphaneden gelir.
