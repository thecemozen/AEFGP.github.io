# K1 Max Dilimleyici

Creality K1 Max için tarayıcıda çalışan basit bir STL → G-code dilimleyici. Kurulum gerekmez; dosyalar bilgisayarınızdan dışarı gönderilmez.

## Özellikler
- **OrcaSlicer düzeninde ayarlar:** Yazıcı / Filament / İşlem sekmeleri, ~120 ayar, arama, "Gelişmiş" görünümü,
  kendi profillerinizi kaydetme / silme / dışa-içe aktarma
- **Hazır profiller** (K1 Max 0.4): 0.08–0.28 mm işlem profilleri, vazo modu; PLA, Hyper PLA, PLA Mat/Silk/CF, PETG, Hyper PETG, ABS, Hyper ABS, ASA, TPU
- **CFS çok renk:** 4 yuva (filament + renk), parça başına yuva atama, temizleme kulesi, düzenlenebilir filament değiştirme G-code'u,
  yuva başına filament/gram/maliyet. 3MF'teki Orca/Bambu/Prusa parça atamaları otomatik okunur
- **Destek** (eşik açısı, Z/XY mesafeleri, arayüz katmanları, yalnızca tabladan, ayrı destek filamenti), **köprü algılama**,
  **ütüleme**, **vazo modu**, monoton üst yüzey, 6 dolgu deseni, XY delik/kontur telafisi
- **Yazıcıya bağlantı (Moonraker/Fluidd):** ağda yazıcı arama (Android), yükle / yükle ve başlat, sıcaklık-ilerleme durumu,
  duraklat / devam / iptal; G-code içine Fluidd önizleme resmi; isteğe bağlı EXCLUDE_OBJECT
- Klipper G-code: `START_PRINT`/`END_PRINT`, hareket türüne göre ivme, SCV, pressure advance, yan/kasa fanı (M106 P2/P3)
- STL ve 3MF açma, parçalara ayırma, yan yana dizme, döndürme, ölçekleme, yüzeye yatırma

## İndir ve kur (internet gerekmez)
- **Bilgisayar:** [`dist/K1MaxDilimleyici.html`](dist/K1MaxDilimleyici.html) dosyasını indirin, çift tıklayın. Chrome / Edge / Firefox'ta açılır, tamamen çevrimdışı çalışır.
- **Android (APK):** [`dist/K1MaxDilimleyici.apk`](dist/K1MaxDilimleyici.apk) dosyasını telefona indirin, açın ve
  *Bilinmeyen kaynaklardan yüklemeye izin ver* deyin. Android 7.0 ve üstü.
  - STL dosyasını uygulamadan **Model → STL Aç** ile seçin ya da dosya yöneticisinde *Birlikte aç → K1 Max Dilimleyici* deyin.
  - **İndir** G-code'u `İndirilenler/K1Max` klasörüne kaydeder; **Paylaş** Creality Cloud, Drive, WhatsApp vb. ile gönderir.

### Yeniden derleme
```bash
cd k1max/tools && npm install && node build-standalone.mjs   # tek dosyalık HTML
bash ../android/build-apk.sh                                  # APK (aapt, dx, apksigner gerekir)
```
APK, ilk derlemede oluşturulan `android/k1max-release.jks` anahtarıyla imzalanır (depoya eklenmez).
Farklı anahtarla derlenen yeni sürümü kurmadan önce eski uygulamayı kaldırmanız gerekir.

## Android'de tarayıcıdan kullanım (PWA)
1. Telefonda Chrome ile sayfayı açın.
2. **Uygulamayı yükle** düğmesine (ya da Chrome menüsü → *Ana ekrana ekle*) dokunun. Uygulama ana ekrana kurulur ve tam ekran açılır.
3. İlk açılıştan sonra internet olmadan da çalışır.
4. **Model** sekmesinden STL açın, **Dilimle**'ye dokunun, **Önizleme**'de katmanlara bakın.
5. **İndir** G-code'u İndirilenler klasörüne kaydeder; **Paylaş** dosyayı Creality Cloud, Drive, WhatsApp gibi uygulamalara gönderir. Sonra USB bellekle ya da Creality Cloud üzerinden yazıcıya aktarın.

## CFS notu
Varsayılan filament değiştirme G-code'u `T{next_tool}` komutunu gönderir; kesme/boşaltma/yükleme işini yazıcının
firmware'i yapar. Firmware sürümünüze göre farklı bir dizi gerekebilir: Creality Print'teki K1 Max (CFS) profilinin
"Filament değiştirme G-code"unu **Ayarlar → Yazıcı → CFS / renk değişimi** alanına yapıştırabilirsiniz.
İlk çok renkli baskıyı küçük bir modelle deneyin.

## Sınırlamalar
- Ağaç (tree) destek, boyama ile renklendirilmiş 3MF, değiştirici hacimler, değişken katman yüksekliği ve duvar kesişimini önleme (avoid crossing walls) yoktur.
- Bilgisayar sürümü (tek HTML) tarayıcı güvenliği nedeniyle yazıcı durumunu okuyamayabilir; Android uygulamasında bu kısıt yoktur.
- Süre tahmini yaklaşıktır.

## Dosyalar
- `slicer-core.js` — dilimleme motoru (Web Worker ve Node'da çalışır)
- `presets.js` — K1 Max ayarları
- `app.js` — arayüz, profiller, 3B önizleme, yazıcı bağlantısı
- `threemf.js` — 3MF okuyucu
- `tools/build-standalone.mjs` — tek dosyalık HTML üretir
- `android/` — APK kaynakları (WebView kabuğu, `build-apk.sh`)
- Kütüphaneler jsDelivr CDN'den sabit sürümle yüklenir: three.js 0.160.0 (MIT), clipper-lib 6.4.2 (Boost lisansı)
