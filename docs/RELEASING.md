# GitHub yayını

Kaynaklar MIT lisansıyla paylaşılır. Repo anahtar, hesap, tarayıcı profili, sohbet/iş veritabanı, avatar veya Codex uygulamasının çıkarılmış dosyalarını içermez. Yerel verileri silmeden dağıtılabilir kaynak paketi oluşturulur.

## Kontrol

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run release:check
npm audit --audit-level=moderate
npm run release:source
```

GitHub Actions Windows ve Ubuntu'da aynı kontrolleri yapacak biçimde hazırlanmıştır. Workflow henüz GitHub'da çalıştırılmadıysa yerel sonuçları GitHub CI sonucu olarak sunmayın. Native Codex testi özel istemci dosyaları verilmezse açıkça atlanır.

`release:check` dağıtılacak kaynakları tarar. Repo bir Git checkout'ıysa indekste/commit'te bulunan dosyaları da kontrol eder; `.gitignore` daha önce takip edilen sırları kaldırmaz. Eski commit geçmişini otomatik taramaz. Daha önce bir sır yayınlandıysa sadece silmek yetmez: ilgili anahtarı iptal edin ve geçmişi ayrıca inceleyin.

`release:source` `.data/releases/damndots-v0.1-source.zip` ve yanında dosya hashlerini içeren `manifest.json` üretir. Tek dosya adı güncellenir; tarihli kopyalar birikmez. Paket otomatik olarak GitHub'a yüklenmez.

## İlk repo

Arşivi **yeni, boş bir dizine** çıkarın ve yalnız o temiz kaynak dizinini GitHub'a gönderin. Böylece bu geliştirme klasörünün runtime verileri ve test yardımcıları repoya girmez.

```sh
git init -b main
git add .
git diff --cached --stat
git diff --cached --check
npm run release:check
git commit -m "Initial self-hosted Dots source"
```

GitHub'da repo adını/görünürlüğünü seçip oluşturduktan sonra o reponun verdiği remote komutlarını kullanın. Kaynak paketi, yerel `.data` dizininin yedeği değildir.

## Yayın notlarında belirtilecek sınırlar

- Native entegrasyon deneysel ve Windows MSIX/Codex sürümüne bağlıdır. Bilinen yerel kabul sürümü [ACCEPTANCE](ACCEPTANCE.md) içindedir.
- Linux masaüstü yerel Debian kurulumudur; OpenAI'ın kendi bulut imajı dağıtılmaz.
- Dashboard tek yönetici içindir. İnternete açılacaksa HTTPS ve izin verilen backend adresleri ayarlanmalıdır.
- Slack/Teams/e-posta/GitHub için kontrollü protokol testleri, gerçek hesaplarda tam kabul anlamına gelmez.
- Docker imajları ayrı doğrulanmalıdır; Docker kurulu olmayan makinede yalnız dosya incelemesiyle "Docker test edildi" denmez.

GitHub repo ayarlarında private vulnerability reporting'i açın. Otomatik CI ve Dependabot dosyaları kaynak dağıtımına dahildir.
