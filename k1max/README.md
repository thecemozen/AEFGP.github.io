# K1 Max Dilimleyici

Creality K1 Max için tarayıcıda çalışan basit bir STL → G-code dilimleyici. Kurulum gerekmez; dosyalar bilgisayarınızdan dışarı gönderilmez.

## Özellikler
- K1 Max hazır ayarları: PLA, Hyper PLA, PETG, ABS, ASA, TPU × 0.12 / 0.20 / 0.20 sağlam / 0.28 kalite
- Klipper uyumlu G-code: `START_PRINT` / `END_PRINT` makroları, hareket türüne göre ivme (`SET_VELOCITY_LIMIT`), pressure advance, `SET_PRINT_STATS_INFO` katman bilgisi
- Duvarlar, üst/alt katı yüzeyler, ızgara / gyroid / üçgen / çizgi dolgu
- Hacimsel akış sınırı, minimum katman süresi (yavaşlatma), fan rampası, geri çekme + Z kaldırma
- Etek (skirt) ve kenarlık (brim), fil ayağı telafisi, hizalı arka dikiş
- Katman katman 3B önizleme, süre ve filament tahmini
- Model döndürme, ölçekleme, "yüzeye yatır"

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

## Sınırlamalar
- **Destek (support) üretmez.** Büyük çıkıntılı modeller için OrcaSlicer / Creality Print kullanın veya modeli desteksiz basılacak şekilde yönlendirin.
- Köprü algılama, ironing, çoklu nesne ve 3MF desteği yoktur.
- Süre tahmini yaklaşıktır.

## Dosyalar
- `slicer-core.js` — dilimleme motoru (Web Worker ve Node'da çalışır)
- `presets.js` — K1 Max ayarları
- `app.js` — arayüz ve 3B önizleme
- `tools/build-standalone.mjs` — tek dosyalık HTML üretir
- `android/` — APK kaynakları (WebView kabuğu, `build-apk.sh`)
- Kütüphaneler jsDelivr CDN'den sabit sürümle yüklenir: three.js 0.160.0 (MIT), clipper-lib 6.4.2 (Boost lisansı)
