/*
 * Creality K1 Max için hazır ayarlar.
 * Değerler Creality Print / OrcaSlicer'ın K1 Max (0.4 nozul) profillerinden ve
 * yaygın topluluk ayarlarından derlendi. Kendi filamentinize göre ince ayar yapın.
 */
export const PRINTER = {
  name: 'Creality K1 Max',
  bedX: 300, bedY: 300, bedZ: 300,
  nozzle: 0.4,
  maxAccel: 20000,
  maxSpeed: 600,
};

export const START_GCODE = `M140 S{bed_first}
M104 S{nozzle_first}
START_PRINT EXTRUDER_TEMP={nozzle_first} BED_TEMP={bed_first}
M190 S{bed_first}
M109 S{nozzle_first}`;

export const END_GCODE = `END_PRINT`;

// Temel (her preset bunların üzerine yazar)
export const BASE = {
  // kalite
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  lineWidth: 0.42,
  firstLayerLineWidth: 0.5,
  walls: 2,
  topLayers: 5,
  bottomLayers: 3,
  infillDensity: 15,
  infillPattern: 'grid',
  infillOverlap: 15,
  solidAngle: 45,
  wallOrder: 'inner-outer',
  seam: 'rear',
  seamGap: 0.15,
  topFlow: 1.0,
  xyCompensation: 0,
  elephantFoot: 0.1,
  // hız (mm/s)
  outerWallSpeed: 200,
  innerWallSpeed: 300,
  sparseInfillSpeed: 270,
  solidInfillSpeed: 250,
  topSurfaceSpeed: 200,
  firstLayerSpeed: 50,
  travelSpeed: 500,
  zSpeed: 15,
  minSpeed: 20,
  // ivme (mm/s²)
  accelOuterWall: 5000,
  accelInnerWall: 10000,
  accelInfill: 12000,
  accelTop: 5000,
  accelFirst: 500,
  accelTravel: 12000,
  // geri çekme
  retractLength: 0.8,
  retractSpeed: 40,
  deretractSpeed: 40,
  retractExtra: 0,
  retractMinTravel: 1.5,
  zHop: 0.2,
  zHopSpeed: 15,
  // ilk katman yapışma
  skirtLoops: 1,
  skirtDistance: 5,
  brimWidth: 0,
  // soğutma
  fanOffLayers: 1,
  fanFullLayer: 3,
  fanMin: 100,
  fanMax: 100,
  minLayerTime: 6,
  minSpeedFactor: 0.25,
  // filament
  filamentDiameter: 1.75,
  filamentDensity: 1.24,
  flowRatio: 0.98,
  maxVolumetric: 21,
  pressureAdvance: 0.04,
  chamberTemp: 0,
  timeFactor: 1.08,
  previewTravel: false,
};

export const FILAMENTS = {
  pla: {
    label: 'PLA (Genel)',
    filamentType: 'PLA',
    nozzleTemp: 220, nozzleTempFirst: 220, bedTemp: 55, bedTempFirst: 60,
    fanMin: 100, fanMax: 100, fanOffLayers: 1, fanFullLayer: 3,
    maxVolumetric: 21, pressureAdvance: 0.04, filamentDensity: 1.24, flowRatio: 0.98,
    retractLength: 0.8, minLayerTime: 6,
  },
  hyperpla: {
    label: 'Hyper PLA (Hızlı PLA)',
    filamentType: 'PLA',
    nozzleTemp: 230, nozzleTempFirst: 230, bedTemp: 55, bedTempFirst: 60,
    fanMin: 100, fanMax: 100, fanOffLayers: 1, fanFullLayer: 3,
    maxVolumetric: 30, pressureAdvance: 0.035, filamentDensity: 1.24, flowRatio: 0.98,
    retractLength: 0.8, minLayerTime: 5,
  },
  petg: {
    label: 'PETG',
    filamentType: 'PETG',
    nozzleTemp: 240, nozzleTempFirst: 240, bedTemp: 70, bedTempFirst: 70,
    fanMin: 30, fanMax: 50, fanOffLayers: 2, fanFullLayer: 4,
    maxVolumetric: 12, pressureAdvance: 0.06, filamentDensity: 1.27, flowRatio: 0.96,
    retractLength: 1.0, retractSpeed: 30, deretractSpeed: 30, zHop: 0.4, minLayerTime: 8,
    outerWallSpeed: 150, innerWallSpeed: 200, sparseInfillSpeed: 200, solidInfillSpeed: 180, topSurfaceSpeed: 120,
  },
  abs: {
    label: 'ABS (kapak kapalı)',
    filamentType: 'ABS',
    nozzleTemp: 255, nozzleTempFirst: 260, bedTemp: 100, bedTempFirst: 100,
    fanMin: 0, fanMax: 20, fanOffLayers: 3, fanFullLayer: 6,
    maxVolumetric: 20, pressureAdvance: 0.04, filamentDensity: 1.04, flowRatio: 0.95,
    retractLength: 0.8, minLayerTime: 10, brimWidth: 3, skirtLoops: 0,
  },
  asa: {
    label: 'ASA (kapak kapalı)',
    filamentType: 'ASA',
    nozzleTemp: 260, nozzleTempFirst: 265, bedTemp: 100, bedTempFirst: 100,
    fanMin: 0, fanMax: 25, fanOffLayers: 3, fanFullLayer: 6,
    maxVolumetric: 18, pressureAdvance: 0.045, filamentDensity: 1.07, flowRatio: 0.95,
    retractLength: 0.8, minLayerTime: 10, brimWidth: 3, skirtLoops: 0,
  },
  tpu: {
    label: 'TPU 95A',
    filamentType: 'TPU',
    nozzleTemp: 230, nozzleTempFirst: 230, bedTemp: 45, bedTempFirst: 45,
    fanMin: 80, fanMax: 100, fanOffLayers: 1, fanFullLayer: 3,
    maxVolumetric: 3.6, pressureAdvance: 0.1, filamentDensity: 1.21, flowRatio: 1.0,
    retractLength: 0.4, retractSpeed: 20, deretractSpeed: 20, zHop: 0, minLayerTime: 8,
    outerWallSpeed: 30, innerWallSpeed: 40, sparseInfillSpeed: 40, solidInfillSpeed: 40, topSurfaceSpeed: 30,
    firstLayerSpeed: 20, travelSpeed: 300,
    accelOuterWall: 2000, accelInnerWall: 2000, accelInfill: 2000, accelTop: 2000, accelTravel: 5000,
  },
};

export const QUALITIES = {
  fine: {
    label: '0.12 mm · İnce detay',
    layerHeight: 0.12, firstLayerHeight: 0.2, walls: 3, topLayers: 7, bottomLayers: 5,
    outerWallSpeed: 150, innerWallSpeed: 250, topSurfaceSpeed: 150,
  },
  standard: {
    label: '0.20 mm · Standart',
    layerHeight: 0.2, firstLayerHeight: 0.2, walls: 2, topLayers: 5, bottomLayers: 3,
  },
  strong: {
    label: '0.20 mm · Sağlam (mekanik parça)',
    layerHeight: 0.2, firstLayerHeight: 0.2, walls: 4, topLayers: 6, bottomLayers: 4,
    infillDensity: 35, infillPattern: 'gyroid',
  },
  draft: {
    label: '0.28 mm · Hızlı taslak',
    layerHeight: 0.28, firstLayerHeight: 0.28, walls: 2, topLayers: 4, bottomLayers: 3,
    lineWidth: 0.45, infillDensity: 10,
  },
};

// Hız presetleri, kalite ve filament üzerine çarpan olarak uygulanmaz; doğrudan değerdir.
export function buildSettings(filamentKey, qualityKey) {
  const s = Object.assign({}, BASE, QUALITIES[qualityKey] || {}, FILAMENTS[filamentKey] || {});
  // İnce katmanda filamentin hızlarını kalite sınırına göre kırp
  const q = QUALITIES[qualityKey] || {};
  ['outerWallSpeed', 'innerWallSpeed', 'topSurfaceSpeed'].forEach(k => {
    if (q[k] && FILAMENTS[filamentKey] && FILAMENTS[filamentKey][k]) s[k] = Math.min(q[k], FILAMENTS[filamentKey][k]);
  });
  s.startGcode = START_GCODE;
  s.endGcode = END_GCODE;
  return s;
}
