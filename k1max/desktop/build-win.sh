#!/usr/bin/env bash
# Windows kurulum programını Linux'ta üretir: Electron (Windows x64) + tek dosyalık arayüz + NSIS.
# Gerekenler: node, npm, unzip, curl, makensis (apt install nsis)
# Önce arayüzü paketleyin: (cd ../tools && npm install && node build-standalone.mjs)
set -euo pipefail
cd "$(dirname "$0")"
ELECTRON_VERSION="${ELECTRON_VERSION:-33.2.1}"
ELECTRON_SHA256="${ELECTRON_SHA256:-c325a6d905c67107e166267813ea2151ae7fd316c0a88de0081db0b9851a9946}"
VERSION="$(sed -nE 's/.*android:versionName="([0-9.]+)".*/\1/p' ../android/AndroidManifest.xml)"
OUT="${OUT:-../dist/K1MaxDilimleyici-Kurulum-$VERSION.exe}"
APPDIR=build/K1MaxDilimleyici

[ -f ../dist/K1MaxDilimleyici.html ] || { echo "../dist/K1MaxDilimleyici.html yok: önce tools/build-standalone.mjs çalıştırın"; exit 1; }

echo "1/5 Electron $ELECTRON_VERSION (Windows x64)"
mkdir -p build/cache
ZIP="build/cache/electron-v$ELECTRON_VERSION-win32-x64.zip"
[ -f "$ZIP" ] || curl -sSL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip"
echo "$ELECTRON_SHA256  $ZIP" | sha256sum -c --quiet

echo "2/5 Uygulama klasörü"
rm -rf "$APPDIR" && mkdir -p "$APPDIR"
unzip -q "$ZIP" -d "$APPDIR"
rm -f "$APPDIR/resources/default_app.asar" "$APPDIR/LICENSES.chromium.html"
mv "$APPDIR/electron.exe" "$APPDIR/K1MaxDilimleyici.exe"
# yalnızca Türkçe ve İngilizce arayüz dilleri (kurulum boyutu küçülür)
find "$APPDIR/locales" -name '*.pak' ! -name 'tr.pak' ! -name 'en-US.pak' -delete
mkdir -p "$APPDIR/resources/app/app"
cp main.js preload.js icon.ico "$APPDIR/resources/app/"
sed -E "s/\"version\": \"[^\"]+\"/\"version\": \"$VERSION.0\"/" package.json > "$APPDIR/resources/app/package.json"
cp ../dist/K1MaxDilimleyici.html "$APPDIR/resources/app/app/index.html"

echo "3/5 Program simgesi ve sürüm bilgisi"
[ -d build/tools/node_modules/resedit ] || npm install --silent --prefix build/tools resedit@3.1.0 pe-library@1.0.1 >/dev/null
cp set-exe-meta.mjs build/tools/
node build/tools/set-exe-meta.mjs "$APPDIR/K1MaxDilimleyici.exe" icon.ico "$VERSION"

echo "4/5 Kurulum programı"
mkdir -p "$(dirname "$OUT")"
makensis -V2 -DVERSION="$VERSION" -DSRCDIR="$APPDIR" -DOUTFILE="$(realpath -m "$OUT")" installer.nsi

echo "5/5 Hazır: $OUT ($(du -h "$OUT" | cut -f1))"
