/*
 * Creality K1 Max (CFS) için ayar şeması ve hazır profiller.
 *
 * Değerler Creality Print / OrcaSlicer'ın K1 Max (0.4 nozul) profillerinden ve yaygın topluluk
 * ayarlarından derlendi; makinenize ve filamentinize göre kalibre edilmiş değildir.
 * Özellikle akış oranı (flow) ve pressure advance için kalibrasyon baskısı yapmanız önerilir.
 *
 * Şema: her ayar { k: anahtar, l: etiket, u: birim, t: tür, min, max, s: adım, o: seçenekler, tip: açıklama, adv: gelişmiş }
 *   t: 'n' sayı, 'on' boş bırakılabilir sayı (boş = yazıcı ayarı), 'b' aç/kapa, 's' seçim, 'g' çok satırlı G-code, 'c' renk, 'x' metin
 */

// ------------------------------------------------------------------ G-code şablonları
export const START_GCODE = `M140 S{bed_first}
M104 S{nozzle_first}
START_PRINT EXTRUDER_TEMP={nozzle_first} BED_TEMP={bed_first}
M190 S{bed_first}
M109 S{nozzle_first}`;

export const END_GCODE = `END_PRINT`;

// CFS renk değişimi. Firmware sürümünüze göre değişebilir: Creality Print'teki K1 Max (CFS)
// yazıcı profilinin "Filament değiştirme G-code"unu buraya yapıştırabilirsiniz.
export const CHANGE_GCODE = `G1 Z{z_lift} F600
T{next_tool}`;

// ------------------------------------------------------------------ YAZICI
export const PRINTER_SCHEMA = [
  { g: 'Yazıcı', items: [
    { k: 'bedX', l: 'Tabla genişliği (X)', u: 'mm', t: 'n', min: 50, max: 500, s: 1 },
    { k: 'bedY', l: 'Tabla derinliği (Y)', u: 'mm', t: 'n', min: 50, max: 500, s: 1 },
    { k: 'bedZ', l: 'Maks. yükseklik (Z)', u: 'mm', t: 'n', min: 50, max: 500, s: 1 },
    { k: 'nozzleDiameter', l: 'Nozul çapı', u: 'mm', t: 's', o: { 0.4: '0.4', 0.6: '0.6', 0.8: '0.8', 0.2: '0.2' }, tip: 'Bilgi amaçlı; çizgi genişliklerini İşlem sekmesinden ayarlayın.' },
  ]},
  { g: 'Makine sınırları', items: [
    { k: 'machineMaxAccel', l: 'Maks. ivme', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500, tip: 'Hiçbir hareket bu ivmeyi aşmaz. K1 Max: 20000.' },
    { k: 'machineMaxSpeed', l: 'Maks. hız', u: 'mm/s', t: 'n', min: 50, max: 1000, s: 10 },
    { k: 'squareCornerVelocity', l: 'Köşe hızı (SCV)', u: 'mm/s', t: 'n', min: 1, max: 20, s: 0.5, tip: 'Klipper square_corner_velocity. Düşük değer köşeleri keskinleştirir, süreyi uzatır.', adv: true },
    { k: 'accelToDecel', l: 'Yavaşlama oranı', u: '%', t: 'n', min: 10, max: 100, s: 5, tip: 'Klipper accel_to_decel = ivme × bu oran.', adv: true },
    { k: 'zSpeed', l: 'Z hareket hızı', u: 'mm/s', t: 'n', min: 1, max: 30, s: 1, adv: true },
  ]},
  { g: 'Geri çekme (varsayılan)', items: [
    { k: 'retractLength', l: 'Uzunluk', u: 'mm', t: 'n', min: 0, max: 10, s: 0.05 },
    { k: 'retractSpeed', l: 'Geri çekme hızı', u: 'mm/s', t: 'n', min: 5, max: 150, s: 1 },
    { k: 'deretractSpeed', l: 'Geri itme hızı', u: 'mm/s', t: 'n', min: 5, max: 150, s: 1 },
    { k: 'zHop', l: 'Z kaldırma', u: 'mm', t: 'n', min: 0, max: 3, s: 0.05 },
    { k: 'retractMinTravel', l: 'Min. hareket mesafesi', u: 'mm', t: 'n', min: 0, max: 20, s: 0.1, tip: 'Bundan kısa boş hareketlerde geri çekme yapılmaz.' },
    { k: 'retractOnLayerChange', l: 'Katman değişiminde geri çek', t: 'b' },
    { k: 'avoidCrossingWalls', l: 'Duvarları geçmeden dolaş', t: 'b', tip: 'Boş hareketler parçanın içinden dolaşır; dış duvarın üzerinden geçip iz bırakmaz.' },
    { k: 'retractOnlyCrossing', l: 'Yalnızca parçadan çıkarken geri çek', t: 'b', tip: 'Hareket parçanın içinde kalıyorsa geri çekme yapılmaz: daha kısa süre, yüzeyde daha az iz.' },
    { k: 'combMaxDetour', l: 'En fazla dolambaç', u: '×', t: 'n', min: 1, max: 5, s: 0.1, tip: 'İçeriden yol düz yolun bu katından uzunsa düz gidilir ve geri çekilir.', adv: true },
    { k: 'wipe', l: 'Geri çekerken sil', t: 'b', tip: 'Geri çekme sırasında nozul son çizginin üzerinde geri gider; uçtaki damlayı siler, ip çekmeyi azaltır.' },
    { k: 'wipeDistance', l: 'Silme mesafesi', u: 'mm', t: 'n', min: 0, max: 5, s: 0.1, adv: true },
    { k: 'wipeRetractPart', l: 'Silme sırasında geri çekme', u: '%', t: 'n', min: 0, max: 100, s: 5, adv: true },
  ]},
  { g: 'CFS / renk değişimi', items: [
    { k: 'toolChangeLift', l: 'Değişimde Z kaldırma', u: 'mm', t: 'n', min: 0, max: 10, s: 0.1, tip: '{z_lift} değişkeni = mevcut Z + bu değer.' },
    { k: 'toolChangeTime', l: 'Değişim süresi (tahmin)', u: 'sn', t: 'n', min: 0, max: 300, s: 5, tip: 'Yalnızca süre tahmini için: kesme, boşaltma, yükleme ve temizlemenin toplam süresi.' },
    { k: 'changeFilamentGcode', l: 'Filament değiştirme G-code', t: 'g', tip: 'Değişkenler: {current_tool} {next_tool} {next_temp} {z} {z_lift} {layer} {flush_volume} (mm³) {flush_length} (mm filament)' },
  ]},
  { g: 'Özel G-code', items: [
    { k: 'startGcode', l: 'Başlangıç G-code', t: 'g', tip: 'Değişkenler: {nozzle_first} {bed_first} {nozzle} {bed} {initial_tool} {first_layer_height} {filament_type}' },
    { k: 'endGcode', l: 'Bitiş G-code', t: 'g' },
    { k: 'layerChangeGcode', l: 'Katman değişimi G-code', t: 'g', tip: 'Her katmanın başında. Değişkenler: {layer} {z}', adv: true },
  ]},
  { g: 'Klipper / Fluidd', items: [
    { k: 'labelObjects', l: 'Nesne etiketle (EXCLUDE_OBJECT)', t: 'b', tip: "Fluidd'de baskı sırasında tek bir parçayı iptal etmeyi sağlar. printer.cfg içinde [exclude_object] bölümü yoksa yazıcı hata verir; emin değilseniz kapalı bırakın." },
    { k: 'thumbnail', l: 'Önizleme resmi ekle', t: 'b', tip: "Fluidd/Mainsail dosya listesinde model resmi gösterilir." },
    { k: 'thumbnailSize', l: 'Resim boyutu', u: 'px', t: 's', o: { 300: '300×300', 200: '200×200', 128: '128×128' }, adv: true },
  ]},
  { g: 'Ağ (Moonraker)', items: [
    { k: 'hostIp', l: 'Yazıcı IP adresi', t: 'x', tip: 'Örn. 192.168.1.50. Cihaz sekmesinden ağı tarayarak bulabilirsiniz.' },
    { k: 'hostPort', l: 'Port', t: 'n', min: 1, max: 65535, s: 1, tip: 'Moonraker: 7125. Fluidd (nginx): 4408.' },
    { k: 'apiKey', l: 'API anahtarı', t: 'x', tip: 'Moonraker yetkilendirme kullanıyorsanız. Genelde boş.', adv: true },
    { k: 'uploadFolder', l: 'Yükleme klasörü', t: 'x', tip: 'gcodes içinde alt klasör (boş = kök).', adv: true },
  ]},
  { g: 'Süre tahmini (öğrenilen)', adv: true, items: [
    { k: 'timeScale', l: 'Öğrenilen süre oranı', u: '×', t: 'n', min: 0.3, max: 3, s: 0.01, tip: 'Cihaz sekmesindeki "Tahmini düzelt" ile yazıcının baskı geçmişinden hesaplanır.' },
    { k: 'startupTime', l: 'Sabit ek süre (ısınma vb.)', u: 'sn', t: 'n', min: 0, max: 1800, s: 10 },
  ]},
];

export const PRINTER_BASE = {
  bedX: 300, bedY: 300, bedZ: 300, nozzleDiameter: 0.4,
  machineMaxAccel: 20000, machineMaxSpeed: 800, squareCornerVelocity: 5, accelToDecel: 50, zSpeed: 15,
  retractLength: 0.8, retractSpeed: 40, deretractSpeed: 40, zHop: 0.2, retractMinTravel: 1.5, retractOnLayerChange: true, avoidCrossingWalls: true, retractOnlyCrossing: true, combMaxDetour: 2, wipe: true, wipeDistance: 1.5, wipeRetractPart: 70,
  toolChangeLift: 2, toolChangeTime: 45, changeFilamentGcode: CHANGE_GCODE,
  startGcode: START_GCODE, endGcode: END_GCODE, layerChangeGcode: '',
  labelObjects: false, thumbnail: true, thumbnailSize: 300,
  hostIp: '', hostPort: 7125, apiKey: '', uploadFolder: '', timeScale: 1, startupTime: 0,
};

export const PRINTER_PRESETS = {
  'Creality K1 Max (CFS) 0.4': {},
  'Creality K1 Max 0.4 (CFS yok)': { toolChangeTime: 0 },
};

// ------------------------------------------------------------------ FİLAMENT
export const FILAMENT_SCHEMA = [
  { g: 'Filament', items: [
    { k: 'filamentType', l: 'Tür', t: 's', o: { PLA: 'PLA', PETG: 'PETG', ABS: 'ABS', ASA: 'ASA', TPU: 'TPU', 'PLA-CF': 'PLA-CF', 'PETG-CF': 'PETG-CF', PA: 'PA / Naylon', PC: 'PC' } },
    { k: 'filamentDiameter', l: 'Çap', u: 'mm', t: 'n', min: 1.5, max: 3, s: 0.01 },
    { k: 'filamentDensity', l: 'Yoğunluk', u: 'g/cm³', t: 'n', min: 0.5, max: 3, s: 0.01 },
    { k: 'cost', l: 'Fiyat', u: '₺/kg', t: 'n', min: 0, max: 100000, s: 10 },
    { k: 'flowRatio', l: 'Akış oranı', t: 'n', min: 0.7, max: 1.3, s: 0.005, tip: 'Kalibre edin: üst yüzeyde boşluk varsa artırın, taşma varsa azaltın.' },
    { k: 'pressureAdvance', l: 'Pressure advance', t: 'n', min: 0, max: 0.5, s: 0.002, tip: '0 = yazıcıdaki ayar kullanılır.' },
    { k: 'maxVolumetric', l: 'Maks. hacimsel akış', u: 'mm³/s', t: 'n', min: 0.5, max: 60, s: 0.5, tip: 'Hız bu akışa göre otomatik sınırlanır.' },
  ]},
  { g: 'Sıcaklık', items: [
    { k: 'nozzleTempFirst', l: 'Nozul (ilk katman)', u: '°C', t: 'n', min: 150, max: 320, s: 1 },
    { k: 'nozzleTemp', l: 'Nozul', u: '°C', t: 'n', min: 150, max: 320, s: 1 },
    { k: 'bedTempFirst', l: 'Tabla (ilk katman)', u: '°C', t: 'n', min: 0, max: 120, s: 1 },
    { k: 'bedTemp', l: 'Tabla', u: '°C', t: 'n', min: 0, max: 120, s: 1 },
  ]},
  { g: 'Soğutma', items: [
    { k: 'fanOffLayers', l: 'Fan kapalı ilk katman', t: 'n', min: 0, max: 20, s: 1 },
    { k: 'fanFullLayer', l: 'Tam fan katmanı', t: 'n', min: 0, max: 30, s: 1 },
    { k: 'fanMin', l: 'Parça fanı (min)', u: '%', t: 'n', min: 0, max: 100, s: 1 },
    { k: 'fanMax', l: 'Parça fanı (maks)', u: '%', t: 'n', min: 0, max: 100, s: 1 },
    { k: 'bridgeFan', l: 'Köprü fanı', u: '%', t: 'n', min: 0, max: 100, s: 1 },
    { k: 'overhangFan', l: 'Çıkıntı fanı', u: '%', t: 'n', min: 0, max: 100, s: 1 },
    { k: 'auxFan', l: 'Yan (yardımcı) fan', u: '%', t: 'n', min: 0, max: 100, s: 5, tip: 'K1 Max yan fanı (M106 P2).' },
    { k: 'chamberFan', l: 'Kasa (egzoz) fanı', u: '%', t: 'n', min: 0, max: 100, s: 5, tip: 'M106 P3. ABS/ASA için kapalı tutun.' },
    { k: 'minLayerTime', l: 'Min. katman süresi', u: 'sn', t: 'n', min: 0, max: 60, s: 1, tip: 'Küçük katmanlar bu süreden kısa sürerse yavaşlatılır.' },
    { k: 'minSpeed', l: 'Yavaşlatmada min. hız', u: 'mm/s', t: 'n', min: 5, max: 100, s: 1 },
  ]},
  { g: 'Geri çekme (filamente özel)', adv: true, items: [
    { k: 'retractLength', l: 'Uzunluk', u: 'mm', t: 'on', min: 0, max: 10, s: 0.05, tip: 'Boş = yazıcı ayarı.' },
    { k: 'retractSpeed', l: 'Hız', u: 'mm/s', t: 'on', min: 5, max: 150, s: 1 },
    { k: 'deretractSpeed', l: 'Geri itme hızı', u: 'mm/s', t: 'on', min: 5, max: 150, s: 1 },
    { k: 'zHop', l: 'Z kaldırma', u: 'mm', t: 'on', min: 0, max: 3, s: 0.05 },
  ]},
  { g: 'Çok renk (CFS)', items: [
    { k: 'purgeMultiplier', l: 'Temizleme çarpanı', t: 'n', min: 0.2, max: 4, s: 0.1, tip: 'Yıkama hacimleri tablosu kapalıyken: bu filamente geçerken temizleme hacmi × bu değer.' },
  ]},
  { g: 'Özel G-code', adv: true, items: [
    { k: 'startGcode', l: 'Filament başlangıç G-code', t: 'g' },
    { k: 'endGcode', l: 'Filament bitiş G-code', t: 'g' },
  ]},
];

const FIL_BASE = {
  filamentType: 'PLA', filamentDiameter: 1.75, filamentDensity: 1.24, cost: 700, flowRatio: 0.98, pressureAdvance: 0.04, maxVolumetric: 21,
  nozzleTempFirst: 220, nozzleTemp: 220, bedTempFirst: 60, bedTemp: 55,
  fanOffLayers: 1, fanFullLayer: 3, fanMin: 100, fanMax: 100, bridgeFan: 100, overhangFan: 100, auxFan: 0, chamberFan: 0,
  minLayerTime: 6, minSpeed: 20,
  retractLength: null, retractSpeed: null, deretractSpeed: null, zHop: null,
  purgeMultiplier: 1, startGcode: '', endGcode: '',
};
export const FILAMENT_BASE = FIL_BASE;

export const FILAMENT_PRESETS = {
  'Genel PLA': {},
  'Hyper PLA': { nozzleTempFirst: 230, nozzleTemp: 230, maxVolumetric: 30, pressureAdvance: 0.035, minLayerTime: 5, cost: 750 },
  'PLA Mat': { nozzleTempFirst: 220, nozzleTemp: 215, maxVolumetric: 18, flowRatio: 0.98, cost: 750 },
  'PLA Silk': { nozzleTempFirst: 225, nozzleTemp: 225, maxVolumetric: 12, flowRatio: 0.98, cost: 850 },
  'PLA-CF': { filamentType: 'PLA-CF', filamentDensity: 1.21, nozzleTempFirst: 230, nozzleTemp: 230, maxVolumetric: 15, pressureAdvance: 0.03, flowRatio: 0.96, cost: 1300 },
  'Genel PETG': { filamentType: 'PETG', filamentDensity: 1.27, flowRatio: 0.96, pressureAdvance: 0.06, maxVolumetric: 12,
    nozzleTempFirst: 240, nozzleTemp: 240, bedTempFirst: 70, bedTemp: 70, fanOffLayers: 2, fanFullLayer: 4, fanMin: 30, fanMax: 50, bridgeFan: 70,
    minLayerTime: 8, retractLength: 1.0, retractSpeed: 30, deretractSpeed: 30, zHop: 0.4, cost: 750 },
  'Hyper PETG': { filamentType: 'PETG', filamentDensity: 1.27, flowRatio: 0.96, pressureAdvance: 0.05, maxVolumetric: 20,
    nozzleTempFirst: 250, nozzleTemp: 250, bedTempFirst: 70, bedTemp: 70, fanOffLayers: 2, fanFullLayer: 4, fanMin: 30, fanMax: 60, bridgeFan: 80,
    minLayerTime: 8, retractLength: 0.8, zHop: 0.4, cost: 800 },
  'Genel ABS': { filamentType: 'ABS', filamentDensity: 1.04, flowRatio: 0.95, maxVolumetric: 20,
    nozzleTempFirst: 260, nozzleTemp: 255, bedTempFirst: 100, bedTemp: 100, fanOffLayers: 3, fanFullLayer: 6, fanMin: 0, fanMax: 20, bridgeFan: 40,
    minLayerTime: 10, cost: 700 },
  'Hyper ABS': { filamentType: 'ABS', filamentDensity: 1.04, flowRatio: 0.95, maxVolumetric: 28,
    nozzleTempFirst: 265, nozzleTemp: 260, bedTempFirst: 100, bedTemp: 100, fanOffLayers: 3, fanFullLayer: 6, fanMin: 0, fanMax: 25, bridgeFan: 40,
    minLayerTime: 8, cost: 750 },
  'Genel ASA': { filamentType: 'ASA', filamentDensity: 1.07, flowRatio: 0.95, pressureAdvance: 0.045, maxVolumetric: 18,
    nozzleTempFirst: 265, nozzleTemp: 260, bedTempFirst: 100, bedTemp: 100, fanOffLayers: 3, fanFullLayer: 6, fanMin: 0, fanMax: 25, bridgeFan: 40,
    minLayerTime: 10, cost: 900 },
  'TPU 95A': { filamentType: 'TPU', filamentDensity: 1.21, flowRatio: 1.0, pressureAdvance: 0.1, maxVolumetric: 3.6,
    nozzleTempFirst: 230, nozzleTemp: 230, bedTempFirst: 45, bedTemp: 45, fanMin: 80, fanMax: 100, minLayerTime: 8,
    retractLength: 0.4, retractSpeed: 20, deretractSpeed: 20, zHop: 0, cost: 1100 },
};

// ------------------------------------------------------------------ İŞLEM (PROCESS)
export const PROCESS_SCHEMA = [
  { g: 'Kalite', sec: 'Kalite', items: [
    { k: 'layerHeight', l: 'Katman yüksekliği', u: 'mm', t: 'n', min: 0.04, max: 0.32, s: 0.01 },
    { k: 'firstLayerHeight', l: 'İlk katman yüksekliği', u: 'mm', t: 'n', min: 0.1, max: 0.35, s: 0.01 },
  ]},
  { g: 'Çözünürlük', sec: 'Kalite', items: [
    { k: 'resolution', l: 'Kesit çözünürlüğü', u: 'mm', t: 'n', min: 0, max: 0.1, s: 0.0005, tip: 'Kesitteki bu mesafeden küçük ayrıntılar sadeleştirilir (Orca: 0.012). Milyonlarca üçgenli modellerde dilimlemeyi kat kat hızlandırır; nozulun basabileceği ayrıntı kaybolmaz.', adv: true },
  ]},
  { g: 'Uyarlanabilir katman', sec: 'Kalite', items: [
    { k: 'adaptiveLayers', l: 'Uyarlanabilir katman yüksekliği', t: 'b', tip: 'Dik duvarlarda kalın, eğik ve kavisli yüzeylerde ince katman: aynı görünüşte daha kısa süre ya da aynı sürede daha pürüzsüz yüzey. Katman yüksekliği ayarı yerine aşağıdaki aralık kullanılır.' },
    { k: 'adaptiveMinH', l: 'En ince katman', u: 'mm', t: 'n', min: 0.04, max: 0.3, s: 0.01 },
    { k: 'adaptiveMaxH', l: 'En kalın katman', u: 'mm', t: 'n', min: 0.08, max: 0.32, s: 0.01, tip: '0.4 mm nozulda 0.28–0.30 mm üstüne çıkmayın.' },
    { k: 'adaptiveQuality', l: 'Yüzey kalitesi', u: '%', t: 'n', min: 0, max: 100, s: 5, tip: '%0: en hızlı (eğimde de kalın katman), %100: en pürüzsüz (eğimde çok ince katman). %50 dengeli.' },
  ]},
  { g: 'Çizgi genişliği', sec: 'Kalite', items: [
    { k: 'lineWidth', l: 'Varsayılan', u: 'mm', t: 'n', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'firstLayerLineWidth', l: 'İlk katman', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01, tip: 'Boş = varsayılan.' },
    { k: 'outerWallLineWidth', l: 'Dış duvar', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'innerWallLineWidth', l: 'İç duvar', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'topLineWidth', l: 'Üst yüzey', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'solidLineWidth', l: 'Katı dolgu', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'sparseLineWidth', l: 'Seyrek dolgu', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
    { k: 'supportLineWidth', l: 'Destek / kule', u: 'mm', t: 'on', min: 0.2, max: 1.2, s: 0.01 },
  ]},
  { g: 'Dikiş', sec: 'Kalite', items: [
    { k: 'seam', l: 'Dikiş konumu', t: 's', o: { corner: 'Köşeye sakla (önerilen)', aligned: 'Hizalı', rear: 'Arka', nearest: 'En yakın', random: 'Rastgele' }, tip: 'Köşeye sakla: dikiş içbükey köşelere yerleşir, köşe yoksa katmanlar boyunca hizalı kalır.' },
    { k: 'scarfSeam', l: 'Eğimli dikiş (scarf)', t: 's', o: { none: 'Kapalı', outer: 'Dış duvarda' }, tip: 'Dış duvar halkası alçaktan başlayıp yükselir, sonunda başlangıcın üzerinden azalan akışla geçilir. Silindir gibi köşesiz yüzeylerde dikiş izini neredeyse yok eder.' },
    { k: 'scarfLength', l: 'Eğim uzunluğu', u: 'mm', t: 'n', min: 2, max: 50, s: 1, adv: true },
    { k: 'scarfStartHeight', l: 'Başlangıç yüksekliği', u: '% katman', t: 'n', min: 0, max: 90, s: 5, adv: true },
    { k: 'seamGap', l: 'Dikiş boşluğu', u: '% gen.', t: 'n', min: 0, max: 50, s: 1, tip: 'Dış duvar halkası bu kadar erken biter; dikiş kabarcığını azaltır.', adv: true },
  ]},
  { g: 'Hassasiyet', sec: 'Kalite', items: [
    { k: 'xyContourCompensation', l: 'XY dış kontur telafisi', u: 'mm', t: 'n', min: -1, max: 1, s: 0.01, tip: 'Pozitif = parça büyür.' },
    { k: 'xyHoleCompensation', l: 'XY delik telafisi', u: 'mm', t: 'n', min: -1, max: 1, s: 0.01, tip: 'Pozitif = delikler büyür (vida delikleri dar çıkıyorsa artırın).' },
    { k: 'elephantFoot', l: 'Fil ayağı telafisi', u: 'mm', t: 'n', min: 0, max: 1, s: 0.01 },
  ]},
  { g: 'Ütüleme', sec: 'Kalite', items: [
    { k: 'ironing', l: 'Ütüleme', t: 's', o: { none: 'Kapalı', top: 'En üst yüzey', all: 'Tüm üst yüzeyler' }, tip: 'Üst yüzeyin üzerinden az akışla tekrar geçerek pürüzsüzleştirir.' },
    { k: 'ironingFlow', l: 'Ütüleme akışı', u: '%', t: 'n', min: 1, max: 50, s: 1, adv: true },
    { k: 'ironingSpacing', l: 'Çizgi aralığı', u: 'mm', t: 'n', min: 0.05, max: 1, s: 0.01, adv: true },
    { k: 'ironingInset', l: 'Kenardan içeri', u: 'mm', t: 'n', min: 0, max: 2, s: 0.05, adv: true },
    { k: 'ironingSpeed', l: 'Ütüleme hızı', u: 'mm/s', t: 'n', min: 5, max: 300, s: 5 },
  ]},
  { g: 'İnce duvarlar ve boşluklar', sec: 'Kalite', items: [
    { k: 'gapFill', l: 'Boşluk doldurma ve ince duvarlar', t: 'b', tip: 'Duvarların ve dolgunun kapatamadığı dar boşluklar ile tek duvarın sığmadığı ince detaylar (yazı, kanat, ince kenar), değişken genişlikte tek çizgiyle basılır.' },
    { k: 'gapFillMin', l: 'En dar boşluk', u: 'mm', t: 'n', min: 0.05, max: 0.4, s: 0.01, tip: 'Bundan dar boşluklar doldurulmaz.', adv: true },
    { k: 'gapFillSpeed', l: 'Boşluk doldurma hızı', u: 'mm/s', t: 'n', min: 10, max: 400, s: 5 },
  ]},
  { g: 'Duvarlar', sec: 'Dayanıklılık', items: [
    { k: 'wallLoops', l: 'Duvar sayısı', t: 'n', min: 1, max: 20, s: 1 },
    { k: 'wallOrder', l: 'Duvar sırası', t: 's', o: { 'inner-outer': 'İç → Dış (yüzey kalitesi)', 'outer-inner': 'Dış → İç (ölçü hassasiyeti)' } },
    { k: 'alternateLayers', l: 'Bir ters bir düz (deneysel)', t: 's', o: { none: 'Kapalı', dir: 'Duvar yönü katman katman ters', order: 'Yön + sıra (tek katmanda önce dolgu)' }, tip: 'Tek numaralı katmanlarda duvarlar ters yönde basılır. "Yön + sıra" modunda o katmanda önce dolgu basılır, böylece kafa bir önceki katmanın bittiği yerden devam eder. Kazanç küçüktür; dikiş ve dış yüzey kalitesini etkileyebilir.' },
  ]},
  { g: 'Üst / alt kabuk', sec: 'Dayanıklılık', items: [
    { k: 'topLayers', l: 'Üst katman sayısı', t: 'n', min: 0, max: 30, s: 1 },
    { k: 'topThickness', l: 'Üst kabuk min. kalınlığı', u: 'mm', t: 'n', min: 0, max: 5, s: 0.1, tip: 'İnce katmanlarda katman sayısı bu kalınlığa ulaşacak kadar artırılır.' },
    { k: 'topPattern', l: 'Üst yüzey deseni', t: 's', o: { monotonic: 'Monoton', lines: 'Çizgi (zikzak)', concentric: 'Eş merkezli' } },
    { k: 'topAngleMode', l: 'Üst yüzey yönü', t: 's', o: { auto: 'Otomatik (en uzun kenara paralel)', alternate: 'Katmana göre değişen', fixed: 'Sabit açı' }, tip: 'Otomatik: çizgiler parçanın en uzun yönünde atılır; daha az çizgi ucu ve dönüş, daha düzgün görünüm.' },
    { k: 'topAngle', l: 'Üst yüzey açısı', u: '°', t: 'n', min: 0, max: 179, s: 1, adv: true },
    { k: 'topFlow', l: 'Üst yüzey akışı', t: 'n', min: 0.8, max: 1.2, s: 0.01, tip: 'Üst yüzeyde çizgiler arasında oluk görüyorsanız %1–3 artırın, kabarıklık varsa azaltın.', adv: true },
    { k: 'bottomLayers', l: 'Alt katman sayısı', t: 'n', min: 0, max: 30, s: 1 },
    { k: 'bottomThickness', l: 'Alt kabuk min. kalınlığı', u: 'mm', t: 'n', min: 0, max: 5, s: 0.1 },
    { k: 'bottomPattern', l: 'Alt yüzey deseni', t: 's', o: { monotonic: 'Monoton', lines: 'Çizgi (zikzak)', concentric: 'Eş merkezli' } },
  ]},
  { g: 'Dolgu', sec: 'Dayanıklılık', items: [
    { k: 'infillDensity', l: 'Seyrek dolgu yoğunluğu', u: '%', t: 'n', min: 0, max: 100, s: 1 },
    { k: 'infillPattern', l: 'Dolgu deseni', t: 's', o: { grid: 'Izgara', gyroid: 'Gyroid', cubic: 'Kübik', triangles: 'Üçgen', rectilinear: 'Doğrusal', concentric: 'Eş merkezli', helix: 'Sarmal (deneysel)', golden: 'Altın açı (deneysel)', speed: 'Hızlı (deneysel)' } },
    { k: 'helixStep', l: 'Sarmal dönüş açısı', u: '°/katman', t: 'n', min: 5, max: 90, s: 1, tip: 'Sarmal desende her katmanda çizgi yönünün dönme miktarı.', adv: true },
    { k: 'infillJoin', l: 'Dolgu çizgilerini birleştir', t: 'b', tip: 'Komşu dolgu çizgilerini bölge içinde kalan kısa bağlantılarla tek hatta birleştirir: daha az boş hareket ve geri çekme. Doğrusal, sarmal, altın açı ve hızlı desenlerde çalışır.' },
    { k: 'infillEvery', l: 'Dolguyu N katmanda bir bas', t: 'n', min: 1, max: 3, s: 1, tip: 'Seyrek dolgu N katmanda bir, N kat kalınlıkta basılır (Orca: infill combination). Malzeme aynı, hareket sayısı 1/N. Katman × N, nozul çapını geçmemeli.' },
    { k: 'infillAngle', l: 'Dolgu açısı', u: '°', t: 'n', min: -180, max: 180, s: 5, adv: true },
    { k: 'solidAngle', l: 'Katı dolgu açısı', u: '°', t: 'n', min: -180, max: 180, s: 5, adv: true },
    { k: 'infillOverlap', l: 'Dolgu/duvar bindirme', u: '%', t: 'n', min: 0, max: 60, s: 1, adv: true },
    { k: 'minSparseArea', l: 'Küçük alanları katı doldur', u: 'mm²', t: 'n', min: 0, max: 100, s: 1, tip: 'Bundan küçük seyrek dolgu alanları katı basılır.', adv: true },
  ]},
  { g: 'Çıkıntılar', sec: 'Hız', items: [
    { k: 'overhangSlowdown', l: 'Çıkıntılarda yavaşla', t: 'b', tip: 'Alt katmanın dışına taşan duvar bölümleri yavaş basılır, havada kalanlarda fan artırılır. Sarkmayı azaltır.' },
    { k: 'overhangSpeedMid', l: 'Kısmi çıkıntı hızı', u: 'mm/s', t: 'n', min: 5, max: 400, s: 5, tip: 'Çizgi genişliğinin %25–75\'i kadar taşan bölümler.' },
    { k: 'overhangSpeed', l: 'Havadaki çıkıntı hızı', u: 'mm/s', t: 'n', min: 5, max: 400, s: 5 },
  ]},
  { g: 'Köprüler', sec: 'Dayanıklılık', items: [
    { k: 'bridgeDetect', l: 'Köprü algılama', t: 'b', tip: 'Havada kalan katı alanlar köprü ayarlarıyla, en kısa açıklık yönünde basılır.' },
    { k: 'bridgeFlow', l: 'Köprü akışı', t: 'n', min: 0.5, max: 1.5, s: 0.01 },
    { k: 'bridgeSpeed', l: 'Köprü hızı', u: 'mm/s', t: 'n', min: 5, max: 300, s: 5 },
  ]},
  { g: 'Hız', sec: 'Hız', items: [
    { k: 'firstLayerSpeed', l: 'İlk katman', u: 'mm/s', t: 'n', min: 5, max: 300, s: 5 },
    { k: 'firstLayerInfillSpeed', l: 'İlk katman dolgu', u: 'mm/s', t: 'n', min: 5, max: 300, s: 5 },
    { k: 'slowLayers', l: 'Yavaş başlangıç katmanı', t: 'n', min: 0, max: 20, s: 1, tip: 'Hız bu kadar katman boyunca ilk katman hızından normale yükselir.', adv: true },
    { k: 'outerWallSpeed', l: 'Dış duvar', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'innerWallSpeed', l: 'İç duvar', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'sparseInfillSpeed', l: 'Seyrek dolgu', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'solidInfillSpeed', l: 'Katı dolgu', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'topSurfaceSpeed', l: 'Üst yüzey', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'supportSpeed', l: 'Destek', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'supportInterfaceSpeed', l: 'Destek arayüzü', u: 'mm/s', t: 'n', min: 5, max: 600, s: 5 },
    { k: 'travelSpeed', l: 'Boş hareket', u: 'mm/s', t: 'n', min: 50, max: 1000, s: 10 },
    { k: 'minSpeedFloor', l: 'Hacim sınırında min. hız', u: 'mm/s', t: 'n', min: 1, max: 100, s: 1, adv: true },
  ]},
  { g: 'İvme', sec: 'Hız', items: [
    { k: 'accelDefault', l: 'Varsayılan', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
    { k: 'accelOuterWall', l: 'Dış duvar', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
    { k: 'accelInnerWall', l: 'İç duvar', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
    { k: 'accelTop', l: 'Üst yüzey', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
    { k: 'accelInfill', l: 'Dolgu / destek', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
    { k: 'accelFirst', l: 'İlk katman', u: 'mm/s²', t: 'n', min: 100, max: 40000, s: 100 },
    { k: 'accelTravel', l: 'Boş hareket', u: 'mm/s²', t: 'n', min: 500, max: 40000, s: 500 },
  ]},
  { g: 'Destek', sec: 'Destek', items: [
    { k: 'supportEnable', l: 'Destek oluştur', t: 'b' },
    { k: 'supportAngle', l: 'Eşik açısı', u: '°', t: 'n', min: 0, max: 90, s: 1, tip: 'Yataya göre bu açıdan daha yatık çıkıntılar desteklenir. 30–45 arası tipik.' },
    { k: 'supportBuildPlateOnly', l: 'Yalnızca tabladan', t: 'b', tip: 'Açıksa destek modelin üzerine oturmaz.' },
    { k: 'supportPattern', l: 'Desen', t: 's', o: { rectilinear: 'Doğrusal', grid: 'Izgara' } },
    { k: 'supportSpacing', l: 'Çizgi aralığı', u: 'mm', t: 'n', min: 0.5, max: 10, s: 0.1 },
    { k: 'supportTopZ', l: 'Üst Z mesafesi', u: 'mm', t: 'n', min: 0, max: 1, s: 0.02, tip: 'Destek ile model arasındaki dikey boşluk; sökmeyi kolaylaştırır.' },
    { k: 'supportBottomZ', l: 'Alt Z mesafesi', u: 'mm', t: 'n', min: 0, max: 1, s: 0.02, adv: true },
    { k: 'supportXY', l: 'XY mesafesi', u: 'mm', t: 'n', min: 0, max: 3, s: 0.05 },
    { k: 'supportInterfaceLayers', l: 'Arayüz katmanı', t: 'n', min: 0, max: 10, s: 1, tip: 'Desteğin üstündeki sık katmanlar; modelin alt yüzeyini düzgünleştirir.' },
    { k: 'supportInterfaceSpacing', l: 'Arayüz boşluğu', u: 'mm', t: 'n', min: 0, max: 3, s: 0.05, adv: true },
    { k: 'supportSlot', l: 'Destek filamenti', t: 's', o: { auto: 'Otomatik', 0: 'Yuva 1', 1: 'Yuva 2', 2: 'Yuva 3', 3: 'Yuva 4' }, tip: 'CFS ile desteği ayrı (ör. kolay sökülen) bir filamentle basabilirsiniz.' },
  ]},
  { g: 'Etek ve kenarlık', sec: 'Diğer', items: [
    { k: 'skirtLoops', l: 'Etek tur sayısı', t: 'n', min: 0, max: 20, s: 1 },
    { k: 'skirtDistance', l: 'Etek mesafesi', u: 'mm', t: 'n', min: 0, max: 50, s: 0.5 },
    { k: 'skirtHeight', l: 'Etek yüksekliği', u: 'katman', t: 'n', min: 1, max: 50, s: 1, adv: true },
    { k: 'brimWidth', l: 'Kenarlık genişliği', u: 'mm', t: 'n', min: 0, max: 30, s: 0.5 },
    { k: 'brimGap', l: 'Kenarlık-model boşluğu', u: 'mm', t: 'n', min: 0, max: 2, s: 0.05, adv: true },
  ]},
  { g: 'Temizleme kulesi (CFS)', sec: 'Diğer', items: [
    { k: 'primeTower', l: 'Temizleme kulesi', t: 'b', tip: 'Birden fazla renk kullanıldığında her değişimde yeni rengi temizlemek için kule basılır.' },
    { k: 'purgeVolume', l: 'Değişim başına temizleme', u: 'mm³', t: 'n', min: 0, max: 1000, s: 5, tip: "Yıkama hacimleri tablosu kapalıyken kullanılır: her renk değişiminde kulede basılacak hacim. Model sekmesi → CFS yuvaları → Yıkama hacimleri ile yuva çifti başına ayarlayın." },
    { k: 'towerWidth', l: 'Kule genişliği', u: 'mm', t: 'n', min: 10, max: 80, s: 1 },
    { k: 'towerSpeed', l: 'Kule hızı', u: 'mm/s', t: 'n', min: 10, max: 400, s: 10, adv: true },
    { k: 'towerAuto', l: 'Kule konumu otomatik', t: 'b' },
    { k: 'towerX', l: 'Kule X', u: 'mm', t: 'n', min: 0, max: 500, s: 1, adv: true },
    { k: 'towerY', l: 'Kule Y', u: 'mm', t: 'n', min: 0, max: 500, s: 1, adv: true },
  ]},
  { g: 'Özel modlar', sec: 'Diğer', items: [
    { k: 'spiralVase', l: 'Vazo modu (spiral)', t: 'b', tip: 'Tek duvar, üstü açık, Z sürekli yükselir. Tek parçalı modeller için.' },
  ]},
  { g: 'Önizleme', sec: 'Diğer', adv: true, items: [
    { k: 'previewTravel', l: 'Boş hareketleri göster', t: 'b' },
    { k: 'timeFactor', l: 'Süre tahmin düzeltmesi', t: 'n', min: 0.5, max: 2, s: 0.01, tip: 'Tahmin edilen süre bu değerle çarpılır. Gerçek süreye göre ayarlayın.' },
  ]},
];

export const PROCESS_BASE = {
  layerHeight: 0.2, firstLayerHeight: 0.2, resolution: 0.0125, adaptiveLayers: false, adaptiveMinH: 0.08, adaptiveMaxH: 0.28, adaptiveQuality: 50,
  lineWidth: 0.42, firstLayerLineWidth: 0.5, outerWallLineWidth: 0.42, innerWallLineWidth: 0.45, topLineWidth: 0.42,
  solidLineWidth: 0.42, sparseLineWidth: 0.45, supportLineWidth: 0.42,
  seam: 'corner', seamGap: 10, scarfSeam: 'none', scarfLength: 10, scarfStartHeight: 0,
  xyContourCompensation: 0, xyHoleCompensation: 0, elephantFoot: 0.1,
  ironing: 'none', ironingFlow: 10, ironingSpacing: 0.15, ironingInset: 0.2, ironingSpeed: 30,
  wallLoops: 2, wallOrder: 'inner-outer', alternateLayers: 'none', gapFill: true, gapFillMin: 0.1, gapFillSpeed: 150,
  topLayers: 5, topThickness: 0.8, topPattern: 'monotonic', topAngleMode: 'auto', topAngle: 0, topFlow: 1.0,
  bottomLayers: 3, bottomThickness: 0, bottomPattern: 'monotonic',
  infillDensity: 15, infillPattern: 'grid', helixStep: 15, infillJoin: false, infillEvery: 1, infillAngle: 45, solidAngle: 45, infillOverlap: 15, minSparseArea: 15,
  bridgeDetect: true, bridgeFlow: 0.95, bridgeSpeed: 50, overhangSlowdown: true, overhangSpeedMid: 100, overhangSpeed: 40,
  firstLayerSpeed: 50, firstLayerInfillSpeed: 80, slowLayers: 0,
  outerWallSpeed: 200, innerWallSpeed: 300, sparseInfillSpeed: 270, solidInfillSpeed: 250, topSurfaceSpeed: 200,
  supportSpeed: 150, supportInterfaceSpeed: 80, travelSpeed: 500, minSpeedFloor: 20,
  accelDefault: 10000, accelOuterWall: 5000, accelInnerWall: 10000, accelTop: 5000, accelInfill: 12000, accelFirst: 500, accelTravel: 12000,
  supportEnable: false, supportAngle: 30, supportBuildPlateOnly: false, supportPattern: 'rectilinear', supportSpacing: 2.5,
  supportTopZ: 0.2, supportBottomZ: 0.2, supportXY: 0.35, supportInterfaceLayers: 2, supportInterfaceSpacing: 0.5, supportSlot: 'auto',
  skirtLoops: 1, skirtDistance: 5, skirtHeight: 1, brimWidth: 0, brimGap: 0.1,
  primeTower: true, purgeVolume: 120, towerWidth: 35, towerSpeed: 150, towerAuto: true, towerX: 230, towerY: 230,
  spiralVase: false, previewTravel: false, timeFactor: 1.08,
};

export const PROCESS_PRESETS = {
  '0.08 mm Ekstra ince': { layerHeight: 0.08, firstLayerHeight: 0.16, wallLoops: 3, topLayers: 9, bottomLayers: 6,
    outerWallSpeed: 120, innerWallSpeed: 200, topSurfaceSpeed: 120, sparseInfillSpeed: 200, solidInfillSpeed: 180 },
  '0.12 mm İnce': { layerHeight: 0.12, firstLayerHeight: 0.2, wallLoops: 3, topLayers: 7, bottomLayers: 5,
    outerWallSpeed: 150, innerWallSpeed: 250, topSurfaceSpeed: 150 },
  '0.16 mm Optimal': { layerHeight: 0.16, firstLayerHeight: 0.2, wallLoops: 2, topLayers: 6, bottomLayers: 4 },
  '0.20 mm Standart': {},
  // Tüm süre kazandıranlar bir arada: uyarlanabilir katman, hızlı dolgu deseni + birleştirme, kalın dolgu çizgisi,
  // yüksek iç ivmeler. Dış duvar ve üst yüzey hız/ivmesi kalite için standart profildeki gibi kalır.
  'Hızlı baskı (uyarlanabilir 0.10–0.28)': { adaptiveLayers: true, adaptiveMinH: 0.1, adaptiveMaxH: 0.28, adaptiveQuality: 40,
    infillPattern: 'speed', infillJoin: true, infillDensity: 12, sparseLineWidth: 0.5, innerWallLineWidth: 0.48,
    topLayers: 4, topThickness: 0.8, bottomLayers: 3, bottomThickness: 0.6,
    innerWallSpeed: 330, sparseInfillSpeed: 320, solidInfillSpeed: 270, accelInnerWall: 12000, accelInfill: 15000, accelTravel: 15000, travelSpeed: 600 },
  '0.20 mm Hızlı dolgu (deneysel)': { infillPattern: 'speed', infillJoin: true, infillEvery: 2 },
  '0.20 mm Sağlam': { wallLoops: 4, topLayers: 6, bottomLayers: 4, infillDensity: 35, infillPattern: 'gyroid' },
  '0.24 mm Taslak': { layerHeight: 0.24, firstLayerHeight: 0.24, topLayers: 4, bottomLayers: 3, lineWidth: 0.45, innerWallLineWidth: 0.45, sparseLineWidth: 0.5 },
  '0.28 mm Ekstra taslak': { layerHeight: 0.28, firstLayerHeight: 0.28, topLayers: 4, bottomLayers: 3, lineWidth: 0.45, innerWallLineWidth: 0.5, sparseLineWidth: 0.5, infillDensity: 10 },
  'Vazo modu 0.24 mm': { layerHeight: 0.24, firstLayerHeight: 0.24, spiralVase: true, wallLoops: 1, bottomLayers: 4, topLayers: 0, infillDensity: 0,
    outerWallLineWidth: 0.5, outerWallSpeed: 150 },
};

export const CATEGORIES = {
  printer: { title: 'Yazıcı', schema: PRINTER_SCHEMA, base: PRINTER_BASE, presets: PRINTER_PRESETS, def: 'Creality K1 Max (CFS) 0.4' },
  filament: { title: 'Filament', schema: FILAMENT_SCHEMA, base: FILAMENT_BASE, presets: FILAMENT_PRESETS, def: 'Genel PLA' },
  process: { title: 'İşlem', schema: PROCESS_SCHEMA, base: PROCESS_BASE, presets: PROCESS_PRESETS, def: '0.20 mm Standart' },
};

export const SLOT_COLORS = ['#f2f2f2', '#1f6feb', '#e5484d', '#2f2f2f'];
export const SLOT_COUNT = 4;
