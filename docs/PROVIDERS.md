# Model sağlayıcıları (özel API)

Dots, Codex'in model isteklerini kendi **model ağ geçidinden** (`/model-gateway/responses`) geçirir. Sağlayıcı (API adresi, anahtar, API biçimi) çalışırken **Ayarlar → Model sağlayıcıları** bölümünden değiştirilir; Codex app-server'ın yeniden başlatılması gerekmez.

## Sağlayıcı ekleme

1. Ayarlar → **+ Sağlayıcı ekle**: ad, API adresi (örn. `https://api.openai.com/v1`), API anahtarı, API biçimi.
2. Kayıtta `GET {adres}/models` ile modeller otomatik çekilir. Adres `/v1` olmadan girildiyse `/v1` otomatik denenir. Liste çekilemezse modeller elle yazılabilir.
3. **Bağlantıyı dene** hem `/responses` hem `/chat/completions` için küçük bir istek yollar ve hangi biçimin çalıştığını söyler; uygun biçimi tek tıkla uygular.
4. **Bunu kullan** sağlayıcıyı etkinleştirir (yeni istekler hemen bu sağlayıcıya gider).

## API biçimleri

- **Responses API**: istekler olduğu gibi iletilir.
- **Chat Completions**: Codex'in Responses isteği sunucuda `/chat/completions` isteğine çevrilir; akış (SSE), araç çağrıları (function ve serbest biçimli araçlar), akıl yürütme metni ve kullanım bilgisi Responses olaylarına geri çevrilir. Chat karşılığı olmayan araç türleri (web_search, local_shell) bu biçimde gönderilmez. Bir model yanıtı yalnızca akıl yürütme alanına yazarsa o metin yanıt olarak gösterilir.

## Model, düşünme düzeyi ve Hızlı mod

- Model seçimi her yerde çekilen listeden yapılır (Ayarlar, Dot profili, yeni Dot, yeni görev); "Özel model adı yaz…" ile listede olmayan bir ad girilebilir.
- Düşünme düzeyi seçenekleri sağlayıcının model başına bildirdiği düzeylerdir (örn. `reasoning_efforts`); bildirmezse low/medium/high sunulur, desteklemediğini bildiren modellerde seçim kapanır.
- **Hızlı mod** (`service_tier=priority`) yalnızca GPT model kimliklerinde sunulur. Sunucu da GPT olmayan modele Hızlı mod atanmasını reddeder; bir Dot/ayar GPT olmayan modele geçirilirse Hızlı mod otomatik kapanır.

## Güvenlik

- API anahtarı AES-256-GCM ile şifrelenip saklanır, hiçbir API yanıtında geri dönmez (`hasKey` bilgisi verilir) ve günlüklenmez.
- Uzak sağlayıcı adresleri HTTPS gerektirir; yerel adresler HTTP olabilir. Yönlendirmeler reddedilir.
- Model ağ geçidi, imza anahtarından türetilen ayrı bir anahtarla yetkilendirilir (yönetici anahtarı kullanılmaz).

Sağlayıcıya ait yapılandırma `apps/server/test/providers.test.ts` ile doğrulanır (şifreleme, gizleme, model keşfi, biçim çevirisi, Hızlı mod kuralı).
