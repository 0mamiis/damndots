# Ana Codex ile Dots

## Kullanım ve etki

`Start-Dots.cmd` yalnız backend, dashboard, worker ve gateway servislerini başlatır. Hiçbir Codex penceresi açılmaz. Servisler hazırken kurulu **orijinal Codex kısayolunu** kullanın. İlk etkinleştirmede açık Codex penceresini bir kez kapatıp yeniden açın.

Windows MSIX paket açılışına dört süreç ortam ayarı verilir: `CODEX_API_BASE_URL`, `CODEX_CLI_PATH`, `CODEX_APP_SERVER_FORCE_CLI`, `NODE_EXTRA_CA_CERTS`. `CODEX_HOME` değiştirilmez. Ana `auth.json/config.toml`, kısayollar ve WindowsApps uygulama dosyaları yeniden yazılmaz.

Gateway HTTPS için özel bir yerel CA oluşturur. Native başlatıcı bu CA'yı **yalnız mevcut Windows kullanıcısının** güvenilir kök sertifika deposuna ekler. Sistem genelindeki sertifika deposu değiştirilmez. Private CA anahtarı ve gateway kimlik bilgileri `.data/local-stack/native` altında kalır; bu dizin kaynak dağıtımına dahil değildir.

## İstekler nasıl yönlenir?

`scripts/native-dots.ts` varsayılan `https://localhost:8000` gatewayini açar. Hesap, uygulama ayarları, eklentiler ve normal sohbetler gerçek uygulama/CLI yolunu kullanır. Dot'a ait uçlar yerel Dots backend'ine ayrı tokenle gider. Dosya uçları önce yerel Dot dosyalarını, bulunamazsa gerçek hesabı dener.

`scripts/native-cli-bridge.mjs`, app-server'ın `account/read` yanıtındaki `workspaceRouting.backendOrigin` değerini yalnız uygulamaya giden yanıtta yerel gateway adresine çevirir. Dot'a ait `thread/read`, `thread/resume` gibi istekler gerçek thread'in sahibi olan backend/worker'a yönlenir; normal Codex thread'leri gerçek kurulu CLI'de kalır.

Uygulamanın özellik bayrakları korunur; native Dot ekranının ihtiyaç duyduğu görünürlük/uyumluluk alanları yerel yanıta eklenir. Bu bir hesap planı yükseltmesi veya OpenAI bulut hizmeti yetkisi değildir. Native protokol sürümle değişebilir.

`scripts/main-codex/native-package.ps1` kurulu paketi izler ve bağlantı ayarlarını kaydeder. `native-resume.cs` bu Windows modunda bekleyen başlangıç iş parçacığını devam ettirir; ek uygulama kopyası açmaz. Yardımcı programlar yerelde derlenir; repoda Codex uygulaması/ASAR dosyaları dağıtılmaz.

## Otomatik komut onayı

Dashboard **Ayarlar → Tam erişim — komut onayı isteme** seçimi kalıcıdır ve varsayılan açıktır. Codex thread/turn başlangıcında `never` ve `danger-full-access` uygulanır; worker görevleri de aynı politikayı alır. Eski yürütme izin talepleri bekletilmeden kabul edilir. Gerçek kullanıcı soruları cevap gerektirir ve proaktif araştırma salt okunur kalır. [Computer modları](COMPUTER-MODES.md) tam erişim sınırlarını açıklar.

## Linux bilgisayarı ve araçlar

İsteğe bağlı WSL2 bilgisayarı her Dot/bilgisayar için ayrı X11 ekranı ve Chromium profili açar. Native computer paneli 1280×800 tam masaüstünü gösterir: tarayıcı, terminal, dosyalar ve native uygulamalar aynı ekran içindedir.

**Take over** agent masaüstü/tarayıcı girdisini kilitler; **Return control** geri verir. Panel kapanınca kontrol Dot'a döner. Masaüstü koordinatları tüm ekranı, browser araçları sayfa içeriğini esas alır.

Ad/avatar/renk, yerel başlangıç sayfasına ve pencere temasına uygulanır. Tema OpenAI'ın kendi temasının kopyası değildir. Kurulum, uygulamalar, çalışma alanı ve grafik sınırları [LINUX-COMPUTER](LINUX-COMPUTER.md) içindedir.

## Ses

Proxy ses yolu ses tanıma → dashboardda seçili Dot modeli → seslendirme biçiminde çalışır. Modelin native Realtime API sağlaması gerekmez; STT ve TTS sağlayıcısı ayrıca yapılandırılır. Konuşma algılama kısa gürültüleri ve sessizlik kaynaklı sahte transkriptleri süzer; her arama ana yazılı sohbetten ayrı bir yürütme thread'i kullanır.

`followCodexVoice` etkinse desteklenen yerel uygulama/hesap koşullarında Codex'te seçili ses okunur ve uygulamanın konuşma hizmeti kullanılır. Ana hesabın oturum dosyası değiştirilmez. Başarılı voice-listesi isteğinden alınan yardımcı başlık dosyasında Authorization/Cookie saklanmaz. Bu yol hesabın kullanım sınırları ve hizmet/protokol sürümüne bağlıdır; reddedilen hizmet başka bir ses olarak gösterilmez.

## Kapatma / geri alma

Dots servis konsolunu kapatın veya `Ctrl+C` ile durdurun. Paket etkinleştirme kaydı servis kapanışında bırakılır. Codex'i kapatıp orijinal kısayoldan açınca normal uygulama yolu kullanılır.

Beklenmedik kapanış sonrasında paket kaydı kalırsa, Dots servisleri kapalıyken proje kökünde:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/main-codex/native-disable.ps1
```

Yerel CA otomatik silinmez; aynı kurulumun yeniden bağlanmasını sağlar. Tam kaldırmada önce servisleri durdurun, sonra mevcut kullanıcının sertifika yöneticisinde bu kurulumun CA dosyasına karşılık gelen **Dots private gateway CA** kaydını kaldırın.

`Restore-Main-Profile.cmd` yalnız eski profil değiştirme yönteminden kalan kaydı geri almak içindir; yeni native bağlantının etkinleştirme aracı değildir. Yedekler `.data` altında özel kalmalıdır.

## Test kapsamı

Doğrulanan yerel Codex MSIX sürümü ve kontroller [ACCEPTANCE](ACCEPTANCE.md) içindedir. Windows API mekanizması: [EnableDebugging](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging). Diğer Codex sürümlerinde gerçek native açılış ayrıca kontrol edilmelidir.
