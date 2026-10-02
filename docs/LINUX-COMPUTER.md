# Yerel Dot Linux bilgisayarı

İsteğe bağlı **Dots-Computer-Debian** WSL2 dağıtımı gerçek Debian 13 (trixie) masaüstünü çalıştırır. Dots servisleri bilgisayarı başlatır; Codex penceresi açmaz. Orijinal Codex kısayolunu kullanın ve Dot'a dashboarddan bu bilgisayarı atayın.

Dosyalar `/home/dot/Workspace` içindedir. Windows'tan `\\wsl.localhost\Dots-Computer-Debian\home\dot\Workspace` yoluyla erişilebilir. Dot normal Linux kullanıcısıdır; sudo yoktur ve Windows sürücüleri bağlanmaz.

## Kurulum ve güncelleme

WSL2 etkin, Dots servisleri kapalıyken:

```powershell
node scripts/setup-linux-computer.mjs
```

Komut resmî Debian kök dosya sistemini indirir, katman hashini OCI manifestiyle doğrular ve ayrı WSL2 dağıtımına aktarır. Paketleri, Node/Codex CLI'yi, private yerel SSH tünelini ve worker kaynaklarını kurar. Başka amaçla oluşturulmuş aynı adlı bir dağıtımı değiştirmez; yeni ad için kurulumda `DOTS_LINUX_DISTRO` kullanın. Özel ad kullanıyorsanız servisleri başlatırken de aynı değişkeni ayarlayın.

Chromium, terminal, dosya yöneticisi, Blender, GIMP, Draw, Go, FreeCAD, Godot, Inkscape, Kdenlive, KiCad, Code, Writer/Calc, QGIS, ParaView, OpenSCAD ve 3D Slicer kurulur. Sürümler repo/sürüm indirmelerine bağlıdır; Godot ve Slicer indirmelerinin hashleri doğrulanır. Kurulum birkaç GB disk ve internet gerektirir.

Kaynak güncellemesi için:

```powershell
node scripts/sync-linux-computer.mjs
# Lockfile / bağımlılıklar değiştiyse bunun yerine --install-deps ekleyin.
node scripts/restart-linux-worker.mjs
```

Yeniden başlatmayı Dot'un çalışan görevi yokken yapın. Dots servisleri açıksa supervisor worker'ı yeniden başlatır. Codex computer panelini kapatıp açın. Etkin dağıtım `.data/linux-computer/active-distro` veya `DOTS_LINUX_DISTRO` ile seçilir.

## Ekran ve kontrol

Her Dot/bilgisayar ayrı X11 ekranı ve Chromium profili kullanır. Native Codex video paneli tam masaüstünü 1280×800 olarak gösterir. **Take over** kullanıcıya kontrol verir; **Return control** Dot'a geri verir. Kontrol devrinde agent masaüstü/tarayıcı girdileri engellenir.

Başlangıç sayfası Dot'un kaydedilmiş adı, avatarı ve rengine göre değişir. Bu proje kendi temasını uygular; OpenAI'ın resmî tema/ISO/imaj dosyası dağıtılmaz. PC kapalıyken bu yerel bilgisayar çalışmaz. Grafikler yazılımla çizilir; ağır 3B işler için donanım GPU performansı beklenmemelidir.

## Akış performansı

Masaüstü 30 FPS hedefiyle yakalanır; gerçek hız PC yüküne göre değişir. FFmpeg başlangıç analizini bekletmez ve her JPEG karesini hemen aktarır. Tuval yeni kare çizilince `requestFrame()` kullanır; ayrı 15 FPS zamanlayıcısı yoktur ([captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)).

Yalnız arka arkaya bekleyen fare konumları birleştirilir; tıklama/tuş/kaydırma/kontrol sınırları korunur. `xdotool mousemove --sync` beklemesi kaldırılmıştır. Unicode tuşlarında X11'in geçici eşlemeyi görebilmesi için kısa gecikme korunur.

2026-10-02 yerel sentetik testinde, 200 fare hareketi sonrası tıklama 1728 ms'den 246 ms'ye indi; güncel video 28,7 FPS, normal tıklamalar 117–145 ms ölçüldü. `abcçışğ` girdisi de doğrulandı. Ölçüm her uygulama için garanti değildir.

## Eski kurulumlar

Ubuntu **Dots-Computer** dağıtımı eski kurulumda varsa korunabilir. Etkin dağıtımı değiştirip worker'ı yeniden başlatmadan önce görevleri bitirin. Aynı anda yalnız bir Dots Linux dağıtımı çalışmalıdır; yerel SSH portu 22444'tür.

`scripts/migrate-linux-state.mjs <kaynak>` eski bilgisayar kimliği, thread ve çalışma dosyalarını taşıyabilir. Tarayıcı profili kopyalanmaz; gerekirse tarayıcıda yeniden giriş yapılır. Kaynak dağıtımın silinmesi bu komutun parçası değildir. `wsl --unregister` dağıtım verilerini kalıcı siler; kaynak güncellemesi için kullanılmaz.
