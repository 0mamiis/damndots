# Computer modları

Sunucular bölümünde hostun bağlantı ayarlarından **Dot’un bilgisayarı** seçilir. Varsayılan **Bağlanan PC** modudur. Kaydetmek seçenekleri saklar; **Ayarları uygula** seçili hostun worker süreçlerini değiştirir. Çalışan görev varken mod/host değişikliği reddedilir.

## Bağlanan PC

Windows worker gerçek kullanıcının birincil ekranını yakalar, Codex computer paneline 1280×800 ölçeğinde yayınlar ve fare/klavye olaylarını Windows SendInput ile iletir. Açık tarayıcı, terminal ve native uygulamalar aynı ekranın parçasıdır. PC modu sanal ortam değildir; kullanıcının gerçek ekranında işlem yapar.

Take over agent girdisini engeller; Return control geri verir. Aynı PC’de yalnız bir Dot paneli kullanıcı kontrolünü tutabilir. Panel kapanınca enjekte edilmiş basılı tuşlar bırakılır. Ekran çözünürlüğü ile video koordinatları ölçeklenir; v0.1 birincil monitörü kullanır. Windows oturumu açık olmalıdır. Windows kilit ekranı/UAC güvenli masaüstünü kontrol etmez.

`dot_desktop_action` gerçek PC ekranı içindir. `dot_browser_action` ayrı otomasyon tarayıcısını yönetir. Model açık PC tarayıcısını kullanacaksa desktop aracını seçmelidir.

## Linux

Dashboarddaki **Linux bilgisayarı kur** formu yerel servis denetleyicisine kurulum işi gönderir. WSL2 Windows’ta önceden etkin olmalıdır; bu özellik işletim sisteminin WSL özelliğini kendiliğinden etkinleştirmez.

Resmî Debian 13 rootfs indirilebilir veya aynı sistemin kullanıcının hazırladığı `.tar`, `.tar.gz`, `.tgz`, `.wsl` imajı seçilebilir. Özel dosyanın bu Windows PC’deki mutlak yolu ve SHA256 değeri gerekir. Dağıtım adı `Damndots-` ile başlar. Hash uyuşmazsa import yapılmaz. Var olan WSL dağıtımı üzerine yazılmaz. Yanlış distro sürümü importtan sonra anlaşılırsa yeni dağıtım korunur ve hata gösterilir; mevcut dağıtımlar silinmez. Özel imaj içerik olarak kullanıcıya aittir; hash dosyanın değişmediğini doğrular, içeriğine güvenilirlik kazandırmaz.

ISO, WSL rootfs değildir ve bu yükleyicide desteklenmez. Kurulum Debian 13 masaüstü paketlerini bekler; her Linux dağıtımıyla uyumluluk iddiası yoktur. Kurulumdan sonra hostun bilgisayar modunu Linux seçip uygula. Ayrıntılar [LINUX-COMPUTER](LINUX-COMPUTER.md).

## Tam erişim

Dot görevleri varsayılan olarak Codex app-server’da `approvalPolicy: never`, `sandbox: danger-full-access` ve her yeni turda `sandboxPolicy: dangerFullAccess` ile çalışır. Bu seçenek worker payload’ına da taşınır; thread devamında eski sandbox ayarı kalmaz. Eski istemciden kalan yürütme onay talepleri de bekletilmeden kabul edilir. Dashboarddaki **Tam erişim — komut onayı isteme** anahtarı ayarı değiştirebilir.

Tam erişim Windows/Linux kullanıcısının işletim sistemi izinleriyle sınırlıdır; yönetici/root yetkisi üretmez. Çalışma dizinleri görev başlangıcı, dosya araçları ve çıktı toplama için kullanılır; tam erişimli shell’in diğer erişilebilir dosyalara ulaşmasını engelleyen bir sandbox değildir.

Gerçek kullanıcı soruları otomatik uydurulmaz. Proaktif araştırma görevleri salt okunur kalır. Haricî app araçları yalnız önceden tanımlanmış bağlantı kapsamlarıyla çalışır.

## Sunucuya bağlı bilgisayar

Üçüncü mod **Sunucuya bağlı bilgisayar**, bu PC’de worker çalıştırmaz. Aktif backend’e zaten kayıtlı bir bilgisayarı kullanır: örneğin Bilgisayarlar bölümünden bağlanan bir VPS ya da başka bir Windows PC. Hostun ayarlarında **Sunucudaki bilgisayar** listesinden birini seç; boş bırakırsan ilk çevrimiçi bilgisayar seçilir. **Ayarları uygula** seçilen bilgisayarı varsayılan yapar ve bu backend’deki tüm Dot’ların bilgisayarını ona çevirir. Seçilen bilgisayar yoksa ya da hiçbiri çevrimiçi değilse uygulama reddedilir ve aktif host değişmez.

Bu mod hem yerel backend (Dot bu PC’de, bilgisayar uzakta) hem de uzak backend (Dot ve bilgisayar uzakta) ile kullanılabilir. Uzak bilgisayarı bağlamak için [README](../README.md) içindeki “Connect another Windows computer” bölümüne bak. Dashboard’daki **Ağ erişimi** bölümü backend’in Tailscale üzerinden açılıp açılmadığını gösterir ve tek tuşla açar; Bilgisayarlar sayfasındaki kayıt anahtarı, uzak makinede çalıştırılacak komutu bu adresle birlikte üretir.
