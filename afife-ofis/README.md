# Afife Ofisi

Atölye Afife için 18 kişilik yapay zekâ ofisi. Her çalışan bir klasör, her klasörün kendi kuralları
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
| Prodüksiyon | Video Editörü | Ham çekimden Reels; masaüstündeki video-kurgu klasöründe, reels-kurgu becerisiyle çalışır | |
| | Seslendirmen | Seslendirme metni + ElevenLabs | |
| | Afiş Tasarımcısı | Dönem/etkinlik afişi, post, story | |
| Instagram Ekibi | Instagram Planlayıcı | Haftalık plan, profil, hesap denetimi (ig-plan, ig-profile, ig-audit) | Pzt 10:00 |
| | Reels Senaristi | Kanca ve çekim senaryosu, tutan içerik uyarlaması (ig-reel, ig-viral, ig-repurpose) | |
| | Caption & Görsel Yazarı | Caption, carousel, story (ig-caption, ig-carousel, ig-story, ig-human) | |
| | Topluluk Yöneticisi | DM, yorum cevabı, iş birliği mesajı (ig-dm, ig-reply, ig-comment) | |
| Reklam & Analiz | Meta Reklam Analisti | Reklam ve Instagram özeti (Supermetrics) | Her gün 00:00 |
| | Reklam Kreatifçisi | Meta reklam metni ve kreatif varyasyonları | |
| | Viral Tahminci | Reels'i yayından önce puanlar (Higgsfield) | |
| Kayıt & Finans | Kayıt Sorumlusu | Grup doluluğu, bekleme listesi, deneme talepleri | Cuma 17:00 |
| | Muhasebeci | Gelir-gider, ay sonu raporu | Ayın son günü 20:00 |
| Web & Etkinlik | Web Editörü | atolyeafife.com metinleri ve SEO | |
| | Etkinlik Planlayıcı | Oyun, konser, dönem sonu takvimi | |

## Kurulum (bir kere, PC'de)

video-kurgu ile aynı yöntem: kurulumu Claude yapar.

1. Claude masaüstü uygulamasında **Code** sekmesini açın ve şunu yazın:
   > GitHub'daki thecemozen/AEFGP.github.io deposunun `ccr-e7449adc-kwdy46` dalındaki `afife-ofis`
   > klasörünü masaüstüme `afife-ofis` adıyla indir. Sonra o klasörü aç ve ofisi kur.
2. Claude `.claude/skills/ofis-kurulum` becerisini izler: Node.js ve Claude Code kontrolü, Kaspersky,
   video-kurgu bağlantısı, fontlar, bağlayıcı izinleri, canlı test, masaüstü kısayolu. Sonunda
   `KURULUM.md` yazar.
3. Bundan sonra masaüstündeki **Afife Ofisi** kısayoluna çift tıklayın. Ofis tarayıcıda açılır.

Elle kurmak isterseniz: Node.js 18+, Claude Code (`claude` komutu, giriş yapılmış), sonra bu klasörde
`Ofisi Ac.cmd`.

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

- `ajanlar/topluluk-yoneticisi/bilgi.md`: yaş grupları, gün/saat, ücretler. Boş kalan bilgi için Topluluk Yöneticisi
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
  CLAUDE.md       bu klasörde konuşan Claude için kurulum/bakım talimatı
  Ofisi Ac.cmd    çift tıkla: sunucuyu başlatır, tarayıcıyı açar
  .claude/skills/ ofis-kurulum, yeni-calisan
  index.html      ofis arayüzü (3B, Three.js)
  server.js       yerel sunucu: yönlendirme, iş kuyruğu, zamanlayıcı, bildirim
  ofis.json       çalışan listesi (arayüz ve sunucu ikisi de buradan okur)
  tema.json       Afife görsel kimliği (kopya; asıl kaynak video-kurgu/markalar/afife)
  ajanlar/_instagram/  Instagram Ekibi ortak kuralları (IG.md) ve hafızası (profil, plan)
  ajanlar/
    ORTAK.md      herkesin uyduğu marka ve gizlilik kuralları
    <id>/CLAUDE.md   o çalışanın kuralları
    <id>/ciktilar/   o çalışanın raporları
```
