// Sayfaya masaüstü uygulamasında çalıştığını bildirir (metinler ve davranışlar buna göre ayarlanır).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('k1Desktop', { platform: process.platform });
