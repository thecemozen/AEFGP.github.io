#!/usr/bin/env bash
# K1 Max Dilimleyici APK'sını Android Studio olmadan derler.
# Gerekenler (Ubuntu): sudo apt install openjdk-17-jdk aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# Önce web arayüzünü tek dosyaya paketleyin: (cd ../tools && npm install && node build-standalone.mjs)
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DX="${DX:-$(command -v dalvik-exchange || command -v dx)}"
KEYSTORE="${KEYSTORE:-k1max-release.jks}"
KS_PASS="${KS_PASS:-k1maxslicer}"
OUT="${OUT:-../dist/K1MaxDilimleyici.apk}"

[ -f app/assets/index.html ] || { echo "app/assets/index.html yok: önce tools/build-standalone.mjs çalıştırın"; exit 1; }

rm -rf build && mkdir -p build/classes build/dex
echo "1/5 Java derleniyor"
mkdir -p build/stubs
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 -bootclasspath "$ANDROID_JAR" -d build/stubs $(find stubs -name '*.java')
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -classpath build/stubs -d build/classes $(find src -name '*.java')

echo "2/5 DEX üretiliyor"
"$DX" --dex --min-sdk-version=24 --output=build/dex/classes.dex build/classes

echo "3/5 Kaynaklar paketleniyor"
aapt package -f -M AndroidManifest.xml -S res -A app/assets -I "$ANDROID_JAR" -F build/unsigned.apk
(cd build/dex && aapt add ../unsigned.apk classes.dex >/dev/null)

echo "4/5 Hizalanıyor"
zipalign -f -p 4 build/unsigned.apk build/aligned.apk

echo "5/5 İmzalanıyor"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias k1max \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=K1 Max Dilimleyici, O=thecemozen, C=TR" >/dev/null 2>&1
fi
mkdir -p "$(dirname "$OUT")"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias k1max --out "$OUT" build/aligned.apk
apksigner verify --print-certs "$OUT" | head -1
echo "Hazır: $OUT ($(du -h "$OUT" | cut -f1))"
