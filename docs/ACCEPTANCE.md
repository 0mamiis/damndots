# Kabul ve doğrulama kapsamı

## Yerel kaynak kontrolleri

2026-10-02'de Node.js 24 ile temiz kaynak paketinde Windows'ta **137 test geçti, 1 test atlandı**: client 13, dashboard 6, server 104, worker 12, kaynak paketi 2. Debian'da **136 test geçti, 2 test atlandı**; Windows'a özel yedekleme testi bu platformda çalışmaz. Her iki platformda da resmî Codex bilgisayar istemcisi testi özel istemci dosyaları verilmediği için açıkça atlanır; bu dosyalar dağıtılmaz.

`npm run typecheck`, temiz kaynak paketi kurulumu/derlemesi, kaynak ve anahtar taraması, bağımlılık audit sonuçları yayın öncesinde ayrıca çalıştırılır. Sonuçlar yayın notuna gerçek çalıştırmanın ardından yazılmalıdır. GitHub Actions dosyası hazırlanmış olması GitHub CI çalışmış demek değildir.

## Canlı yerel kontroller

PC modu eklenmesinden sonraki Windows kontrollerinde client 14, dashboard 6, server 115, worker 12 ve kaynak paketi 2 test geçti. Özel istemci dosyaları gerektiren worker testi normal kaynak testlerinde atlanır. Yeni Windows masaüstü, native Codex video istemcisi ve takeover engeli ayrıca canlı test edildi; tam erişim görev testi Windows proje dosyasını **0 izin isteği** ile okudu. Özel rootfs formu/hash kuralları kontrol edildi; kullanıcıya ait bir imaj verilmediği için onunla gerçek kurulum yapılmadı.

| Alan | Gerçekte kontrol edilen | Kapsam sınırı |
| --- | --- | --- |
| Native Windows | Orijinal MSIX uygulamasında Dot listesi, profil, avatar, mesaj/yanıt, ana ayarlar/geçmiş | Bilinen yerel sürüm 26.930.2377.0; tüm Codex sürümleri için garanti değil |
| Linux computer | Debian WSL2 masaüstü, native video istemcisi, kontrol devri, terminal girdisi, Blender ve yeniden bağlantı | Yerel WSL; VPS/TURN ve donanım GPU hızlandırması kontrol edilmedi |
| Computer gecikmesi | Ayrı Linux masaüstü → Windows native istemci; 200 hareket sonrası tıklama 1728 ms → 246 ms, son akış 28,7 FPS | Sentetik ölçüm, tüm uygulamalarda sabit performans değil |
| Modeller | Gerçek yerel sağlayıcı ve araç çağıran görev; kontrollü Responses/Chat Completions, SSE, hata/timeout testleri | Her custom modelin araç/ses/düşünme desteği aynı değil |
| Dashboard | HeroUI v3; gerçek yerel veriyle desktop/mobile, temalar ve 15 arayüz akışı | UI yazma testlerinde istekler yakalandı; gerçek kullanıcı verisi değiştirilmedi |
| Ses | Gerçek hesap konuşma hizmetinden WebRTC ile ses akışı; kontrollü STT/TTS, VAD, interrupt ve ayrı voice thread testleri | Her mikrofon/dil/sağlayıcı için canlı kabul yok |
| Bağlantılar | Slack/Teams/email/GitHub/MCP/webhook için kontrollü gerçek protokol istekleri | Gerçek haricî hesaplarla tam uçtan uca kabul yapılmadı |

Yerel test ekran görüntüleri, account bilgileri ve `.data` kanıt dosyaları özel çalışma dizininde kalır; public repo bunları içermez.

## Yayından sonra ayrıca doğrulanacaklar

- GitHub Actions'ın yeni repoda Windows ve Ubuntu sonuçları.
- Docker imajlarını Docker bulunan bir ortamda build/start/login ile deneme.
- Başka bir Windows hesabında/dizinde yeni WSL kurulumu ve native MSIX açılışı.
- Gerçek haricî hesap bağlantıları ve farklı Codex güncellemeleri.

Bu sınırlar [README](../README.md) ve [RELEASING](RELEASING.md) ile birlikte değerlendirilmelidir.
