# Afife Ofisi (yönetim klasörü)

> `ajanlar/` altındaki bir klasörden çalışıyorsan bu dosya SENİN için değil: yok say,
> sadece kendi `CLAUDE.md` dosyana ve `ORTAK.md` kurallarına uy.

Bu klasör Atölye Afife'nin yapay zekâ ofisi. Cem ile bu klasörde konuşan Claude, ofisin
**kurulumundan ve bakımından** sorumludur; ajanların işini kendisi yapmaz.

## Ne zaman ne yaparsın
- **"kur", "kurulumu yap", "ofisi kur"** ya da bu klasörde `KURULUM.md` yoksa:
  `.claude/skills/ofis-kurulum/SKILL.md` becerisini uygula.
- **"yeni çalışan ekle", "X için ajan yap"**: `.claude/skills/yeni-calisan/SKILL.md`.
- **"ofisi aç"**: `Ofisi Ac.cmd` dosyasını çalıştır ya da Cem'e çift tıklamasını söyle.
- **Bir ajan hata veriyor**: `kayit/gorevler.jsonl` son satırlarına ve o ajanın `CLAUDE.md`'sine bak.

## Yapı
- `server.js`: yerel sunucu (127.0.0.1:4747). Görevi Genel Müdür'e sorar, ajanı
  `claude -p` ile kendi klasöründe çalıştırır, zamanlanmış işleri başlatır.
- `ofis.json`: çalışan listesi. Arayüz ve sunucu buradan okur; değişince sunucu kendini yeniler.
- `ajanlar/ORTAK.md`: herkesin uyduğu marka, dil ve gizlilik kuralları.
- `ajanlar/<id>/CLAUDE.md`: o çalışanın kuralları; `ciktilar/`: raporları.
- `tema.json`: Afife görsel kimliği. Asıl kaynak `../video-kurgu/markalar/afife/tema.json`.

## Kurallar
- Kullanıcıyla Türkçe konuş. Cem kod bilmiyor: komutları kendin çalıştır, sonucu sade anlat.
- Bilgisayar Windows 11. Kaspersky HTTPS trafiğini denetliyor; sertifika hatasında güvenlik
  kontrolünü kapatma, `ofis-kurulum` becerisindeki çözümü uygula.
- Markayla ilgili her değişiklik `ajanlar/ORTAK.md`'ye yazılır, tek tek ajan dosyalarına değil.
- Fontlar: başlık Playfair Display, diğer yazılar Montserrat.
- Şifreleri hiçbir dosyaya yazma.
