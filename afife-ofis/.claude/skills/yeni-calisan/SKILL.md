---
name: yeni-calisan
description: Afife Ofisi'ne yeni bir yapay zekâ çalışanı (ajan) ekler ya da var olanı değiştirir. "yeni çalışan ekle", "şunun için ajan yap", "X'in görevini değiştir" denince kullan.
---

# Yeni çalışan ekleme

1. Cem'e kısaca sor (bilmediklerini): ne iş yapacak, hangi departman, kendiliğinden çalışacak mı
   (saat/gün), hangi bağlayıcıyı kullanacak. Gerisine sen karar ver.
2. `ofis.json` → `ajanlar` listesine ekle:
   - `id`: küçük harf, Türkçe karaktersiz, tireli (ör. `veli-iletisim`)
   - `ad`, `departman` (var olan bir departman id'si), `model` (`opus` ağır işler, `sonnet` hızlı işler)
   - `aciklama`: tek cümle, arayüzdeki kartta görünür
   - `baglantilar`: kartta görünen liste
   - `araclar`: `Read,Write` + gerekiyorsa `WebSearch,WebFetch`, `Bash`, `mcp__<sunucu>`
   - `anahtar`: Genel Müdür'ün yedek yönlendirmesi için 4-8 anahtar kelime (küçük harf)
   - isteğe bağlı `zamanlama`: `{ "saat": "08:00", "gunler": ["pzt"], "gorev": "..." }`
     (`gunler` yoksa her gün; `"ayinSonGunu": true` ayın son günü)
   - isteğe bağlı `ekKlasorler`: ajanın erişeceği klasörler (bu klasöre göre, ör. `../video-kurgu`)
   - Bir departmanda en fazla 3 kişi sığar; 4. kişi için yeni departman aç (`departmanlar` listesine
     ekle, en fazla 6 oda var; daha fazlası için `index.html`'deki `KOLON`/`SATIR` düzenini genişlet).
3. `ajanlar/<id>/CLAUDE.md` yaz. Var olan bir ajanınkini örnek al; ilk satırlardan sonra
   `@../ORTAK.md` mutlaka olsun. Bölümler: Rolün, Görevlerin, Bağlantıların, Sana özel,
   (varsa) Zamanlanmış iş.
4. `ajanlar/<id>/ciktilar/` klasörünü oluştur.
5. Ofis açıksa sayfayı yenile; sunucu `ofis.json` değişikliğini kendisi görür.
6. Kısa test: `kime` olarak yeni ajanı verip bir görev gönder, çıktı dosyasını kontrol et, test
   çıktısını sil.
7. Dil kuralı: ajan metinlerinde "ders, eğitim, öğrenme, kurs, öğretmek, öğrenci" geçmesin.
