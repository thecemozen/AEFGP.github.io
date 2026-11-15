# Afife Ofisi

Atölye Afife için 16 kişilik yapay zekâ ofisi. Her çalışan bir klasör, her klasörün kendi kuralları
(`CLAUDE.md`) var. Siz görevi yazarsınız, Genel Müdür işi doğru kişiye devreder, o kişi Claude Code
ile işi yapar ve raporunu kendi `ciktilar/` klasörüne bırakır. Bazı çalışanlar belli saatlerde
kendiliğinden çalışır.

```
Siz → Genel Müdür → doğru çalışan → ciktilar/2026-11-15-....md → "Rapor hazır ✓"
```

## Ekip

| Departman | Çalışan | Ne yapar | Kendiliğinden |
|---|---|---|---|
| Yönetim | Genel Müdür | İşi okur, kime gideceğine karar verir | |
| Beyin Takımı | İçerik Avcısı | Günün 5 sanat atölyesi videosu + Afife uyarlaması | Her gün 08:00 |
| | Rakip Analisti | Kadıköy atölyelerinin paylaşım ve reklamları | Pzt 09:00 |
| | Strateji Koçu | Dönem hedefi, doluluğu düşük branş için plan | |
| Prodüksiyon | Reels Editörü | Ham çekimden Afife tarzı Reels (tema.json) | |
| | Seslendirmen | Seslendirme metni + ElevenLabs | |
| | Afiş Tasarımcısı | Dönem/etkinlik afişi, post, story | |
| Sosyal Medya & Reklam | Sosyal Medya Yöneticisi | Haftalık paylaşım planı ve caption | Pzt 10:00 |
| | Reklam Kreatifçisi | Meta reklam metni ve kreatif varyasyonları | |
| | Mesaj Asistanı | DM/yorum/WhatsApp cevap taslağı | |
| Ölçüm & Analiz | Meta Reklam Analisti | Reklam ve Instagram özeti (Supermetrics) | Her gün 00:00 |
| | Viral Tahminci | Reels'i yayından önce puanlar (Higgsfield) | |
| Kayıt & Finans | Kayıt Sorumlusu | Grup doluluğu, bekleme listesi, deneme talepleri | Cuma 17:00 |
| | Muhasebeci | Gelir-gider, ay sonu raporu | Ayın son günü 20:00 |
| Web & Etkinlik | Web Editörü | atolyeafife.com metinleri ve SEO | |
| | Etkinlik Planlayıcı | Oyun, konser, dönem sonu takvimi | |

## Kurulum (bilgisayarınızda, bir kere)

1. **Node.js 18+** kurun: https://nodejs.org
2. **Claude Code** kurun ve giriş yapın:
   ```
   npm install -g @anthropic-ai/claude-code
   claude        # tarayıcıda claude.ai hesabınızla giriş yapın, sonra çıkın
   ```
3. Bu klasörü bilgisayarınıza alın ve çalıştırın:
   ```
   cd afife-ofis
   node server.js
   ```
4. Tarayıcıda **http://127.0.0.1:4747** adresini açın. Sağ üstte "Canlı" yazıyorsa hazırsınız.

Demo kutusu işaretliyken hiçbir şey gerçekten çalışmaz, sadece canlandırılır ve örnek rapor açılır.

## Bağlantılar (MCP)

Ajanların gerçek veriye ulaşması için bağlayıcılar Claude Code'da görünmeli. Terminalde `claude`
açıp `/mcp` yazın; claude.ai'da bağladığınız Google Drive, Supermetrics, Higgsfield, ElevenLabs,
Adobe ve Zapier orada listelenir. Görünmeyen olursa `claude mcp add --scope user ...` ile ekleyin.

Başsız çalışmada (`claude -p`) her araç için izin gerekir. Bir ajana bağlayıcı izni vermek için
`ofis.json` içinde o ajanın `araclar` alanına sunucunun adını ekleyin, örneğin:

```json
"araclar": "Read,Write,mcp__Supermetrics"
```

Sunucu adlarını `/mcp` listesinden alın. Bağlayıcı izni olmayan ajan durmaz; elindekiyle işi yapar ve
raporun sonuna eksik bağlantıyı yazar.

## Doldurulması gerekenler

- `ajanlar/mesaj-asistani/bilgi.md`: yaş grupları, gün/saat, ücretler. Boş kalan bilgi için asistan
  "kontrol edilecek" yazar, tahmin etmez.
- Google Sheets'te **Kayıtlar** ve **Gelir-Gider** tabloları (Kayıt Sorumlusu ve Muhasebeci okur).
- `ajanlar/rakip-analisti/rakipler.md`: izlenecek 5 atölye. Yoksa ilk çalışmada ajan öneri listesi çıkarır.

## Telefona bildirim

İş bitince telefona bildirim için ntfy uygulamasını kurun, tahmin edilmesi zor bir konu adına abone olun
ve sunucuyu şöyle başlatın:

```
NTFY_KONU=afife-ofis-xxxx node server.js        # Windows PowerShell: $env:NTFY_KONU="afife-ofis-xxxx"; node server.js
```

ntfy konuları herkese açıktır; rapora özel bilgi yazılmaz, sadece kısa özet gider.

## Zamanlanmış işler

Saatler `ofis.json` içinde `zamanlama` alanında. Sunucu açıkken saat gelince iş kendiliğinden başlar.
Bilgisayar kapalıyken çalışmasını isterseniz Claude'un zamanlanmış görevlerini (claude.ai/code) ya da
işletim sisteminin zamanlayıcısını kullanın.

## Yeni çalışan eklemek

1. `ofis.json` → `ajanlar` listesine yeni kayıt (id, ad, departman, model, aciklama, baglantilar,
   araclar, anahtar kelimeler, isteğe bağlı zamanlama).
2. `ajanlar/<id>/CLAUDE.md` dosyasını yazın; ilk satırlarda `@../ORTAK.md` kalsın.
3. Sunucu `ofis.json` değişikliğini kendisi görür; sayfayı yenileyin.

## Güvenlik

- Ajanlar hiçbir şeyi kendi başına paylaşmaz, göndermez, ödemez: hep taslak. Son onay sizde.
- Sunucu sadece bu bilgisayardan erişilir (127.0.0.1).
- Ajan çıktıları ve iş kaydı (`kayit/`) git'e girmez.
- Şifreleri ajanlara vermeyin. Drive'daki "Atolye Afife Şifreler" tablosu düz metin; bir şifre
  yöneticisine taşımanız iyi olur.

## Dosyalar

```
afife-ofis/
  index.html      ofis arayüzü (3B, Three.js)
  server.js       yerel sunucu: yönlendirme, iş kuyruğu, zamanlayıcı, bildirim
  ofis.json       çalışan listesi (arayüz ve sunucu ikisi de buradan okur)
  tema.json       Afife görsel kimliği (Reels Editörü kullanır)
  ajanlar/
    ORTAK.md      herkesin uyduğu marka ve gizlilik kuralları
    <id>/CLAUDE.md   o çalışanın kuralları
    <id>/ciktilar/   o çalışanın raporları
```
