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

## Android'de kullanım
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
- Kütüphaneler jsDelivr CDN'den sabit sürümle yüklenir: three.js 0.160.0 (MIT), clipper-lib 6.4.2 (Boost lisansı)
