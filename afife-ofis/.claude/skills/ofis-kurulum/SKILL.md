---
name: ofis-kurulum
description: Afife Ofisi'ni Cem'in Windows bilgisayarına kurar ve test eder. "kur", "kurulumu yap", "ofisi kur" denince ya da klasörde KURULUM.md yoksa kullan. Node.js ve Claude Code kontrolü, Kaspersky sertifikası, video-kurgu bağlantısı, Playfair Display ve Montserrat fontları, MCP bağlayıcı izinleri, canlı test, masaüstü kısayolu ve KURULUM.md notu.
---

# Afife Ofisi kurulumu

Cem kod bilmiyor. Komutları sen çalıştır (PowerShell), her adımın sonunda tek cümleyle ne olduğunu
söyle. Kullanıcıdan bir şey gerekiyorsa (giriş yapmak, onay vermek) açıkça ve tek seferde iste.
Güvenlik kontrollerini (TLS doğrulama, antivirüs) asla kapatma. Her adımın sonucunu not al; en sonda
`KURULUM.md` dosyasına yazacaksın.

## 0. Konum
- Bu klasör `%USERPROFILE%\Desktop\afife-ofis` olmalı. Değilse Cem'e sor, taşımayı öner.
- `..\video-kurgu` klasörü var mı bak. Video Editörü doğrudan o klasörde çalışır. Yoksa not et,
  kuruluma devam et (Video Editörü o zaman hata verir, diğerleri çalışır).

## 1. Node.js (18 veya üstü, tercihen 22)
```powershell
node -v
```
Yoksa ya da 18'den eskiyse: `winget install OpenJS.NodeJS.LTS`. Kurulumdan sonra yeni PowerShell
açman gerekebilir (PATH yenilensin).

## 2. Claude Code komut satırı
Masaüstü uygulamasının Code sekmesi her zaman `claude` komutunu PATH'e koymaz. Kontrol et:
```powershell
claude --version
```
Yoksa resmi kurulumu kullan: `irm https://claude.ai/install.ps1 | iex`
(olmazsa: `npm install -g @anthropic-ai/claude-code`).

Giriş testi:
```powershell
"Sadece tamam yaz." | claude -p --model haiku
```
"tamam" dönmüyorsa giriş gerekiyordur. Bu etkileşimli olduğu için Cem yapmalı: "Başlat menüsünden
PowerShell açın, `claude` yazın, tarayıcıda claude.ai hesabınızla giriş yapın, sonra pencereyi
kapatın." Sonra testi tekrarla.

## 3. Kaspersky sertifikası
Sunucu sadece telefon bildirimi (ntfy) için dışarı bağlanır. Test et:
```powershell
node -e "fetch('https://ntfy.sh').then(r=>console.log('ok',r.status)).catch(e=>console.log('HATA',e.cause?.code||e.message))"
node --use-system-ca -e "fetch('https://ntfy.sh').then(r=>console.log('ok',r.status)).catch(e=>console.log('HATA',e.cause?.code||e.message))"
```
- Birincisi `SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_GET_ISSUER_CERT` verip ikincisi `ok` diyorsa:
  `Ofisi Ac.cmd` zaten `--use-system-ca` ile başlatır, başka şey gerekmez.
- İkisi de hata veriyorsa (eski Node): video-kurgu'daki gibi Windows sertifikalarını bir PEM dosyasına
  aktar (`video-kurgu\.venv\windows-ca.pem` varsa onu kullan) ve kullanıcı ortam değişkeni olarak
  `NODE_EXTRA_CA_CERTS` ayarla.

## 4. Sunucu testi
```powershell
$p = Start-Process node -ArgumentList '--use-system-ca','server.js' -PassThru -WindowStyle Hidden
Start-Sleep 2
Invoke-RestMethod http://127.0.0.1:4747/api/durum
```
`canli: True` dönmeli. Sonra gerçek bir test görevi gönder (ucuz bir ajana, doğrudan):
```powershell
$g = @{ metin = 'Test: "Seramik kaç yaştan başlıyor?" diye soran veliye kısa cevap taslağı yaz.'; kime = 'topluluk-yoneticisi' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:4747/api/gorev -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($g))
```
30-60 saniye bekle, `ajanlar\topluluk-yoneticisi\ciktilar\` altında yeni `.md` oluşmalı. Türkçe karakterler
düzgün mü bak. Sonra Genel Müdür yönlendirmesini dene (`kime` olmadan, ör. "Rakipler bu hafta ne
yaptı?"); `kayit\gorevler.jsonl` son satırında doğru ajan seçilmiş mi kontrol et. Test çıktılarını sil,
sunucuyu kapat: `Stop-Process $p.Id`.

## 5. Bağlayıcılar (MCP)
```powershell
claude mcp list
```
claude.ai'da bağlı olanlar (Google Drive, Supermetrics, Higgsfield, ElevenLabs, Adobe, Zapier) burada
görünmeli. Her birinin araç adı ön ekini bul (`mcp__<sunucu>`; tam adı görmek için
`"Supermetrics araçlarından birinin tam adını yaz" | claude -p` gibi sor). Sonra `ofis.json`'da
ilgili ajanların `araclar` alanına ekle:

| Bağlayıcı | Ajanlar |
|---|---|
| Supermetrics | meta-analist, instagram-planlayici |
| Higgsfield | icerik-avcisi, viral-tahminci, afis-tasarimcisi, reklam-kreatifcisi, reels-senaristi |
| ElevenLabs | seslendirmen |
| Adobe | afis-tasarimcisi |
| Google Drive | strateji-kocu, kayit-sorumlusu, muhasebeci, web-editoru, etkinlik-planlayici |

Görünmeyen bağlayıcıyı not et; Cem'e claude.ai → Ayarlar → Bağlayıcılar'dan kontrol etmesini söyle.
Shopify ofiste kullanılmıyor.

## 5b. Instagram eklentisi
Instagram Ekibi (instagram-planlayici, reels-senaristi, caption-yazari, topluluk-yoneticisi)
`instagram-agent` eklentisinin `ig-*` becerilerini kullanır. Kontrol:
```powershell
"instagram-agent eklentisinin ig-plan becerisi sende yüklü mü? Sadece evet ya da hayır." | claude -p --model haiku --allowedTools Skill
```
Hayırsa eklentiyi kullanıcı kapsamında kur (`claude plugin` komutları ya da Claude uygulamasında
eklenti ayarları); Cem'in hesabında yüklü olanı seç. Sonra testi tekrarla.
Kısa test: `kime = 'caption-yazari'` ile "Seramik atölyesi için tek bir caption yaz" görevi gönder;
raporda ig-caption'ın kullanıldığı ve 3'ten fazla hashtag olmadığı görülmeli. Test çıktısını sil.

## 6. Video-kurgu ve fontlar
`..\video-kurgu` varsa:
1. `video-kurgu\.claude\skills\reels-kurgu\SKILL.md` ve `markalar\afife\` var mı bak.
   Video Editörü testi: `kime = 'video-editoru'`, görev "Taked klasöründeki en yeni çekimi bul ve
   kurgu planı çıkar, render etme." Video Editörü video-kurgu klasöründe açılmalı, reels-kurgu
   becerisini görmeli; raporu `ajanlar\video-editoru\ciktilar\` altına düşmeli.
2. Yeni font kuralı: **başlık Playfair Display, diğer yazılar Montserrat.** Bu, video sistemini
   değiştirdiği için önce Cem'e sor: "video-kurgu'daki Afife temasını da yeni fontlara geçireyim mi?"
3. Onay gelirse:
   - google/fonts deposundan `ofl/montserrat/Montserrat[wght].ttf`,
     `ofl/playfairdisplay/PlayfairDisplay[wght].ttf`, `PlayfairDisplay-Italic[wght].ttf` ve `OFL.txt`
     dosyalarını indir (Python içinden indiriyorsan `truststore.inject_into_ssl()` kullan).
   - Değişken fontlardan sabit kalınlıklar çıkar (fontTools, `.venv` içinde var):
     `video-kurgu\.venv\Scripts\python.exe -m fontTools.varLib.instancer <dosya> wght=<değer> -o <ad>.ttf`
     Gerekenler: Montserrat-Regular (400), Montserrat-Medium (500), Montserrat-SemiBold (600),
     Montserrat-Bold (700), PlayfairDisplay-Bold (700), PlayfairDisplay-Italic (italik dosyadan 600).
   - `video-kurgu\fontlar\` altına koy, lisansı `LISANS-Montserrat.txt` / `LISANS-PlayfairDisplay.txt`.
   - `markalar\afife\tema.json` fontlarını bu klasördeki `tema.json` ile eşle (`fontlar`,
     `altyazi.font`); `marka_kimligi.md` font satırını güncelle.
   - Test: "Çocuk Ğİ şü atölye" metnini iki fontla küçük bir PNG'ye çiz, Türkçe harfleri kontrol et.
   - Montserrat, Poppins'ten geniştir: bir test altyazısı çiz, `max_genislik` taşıyorsa
     `altyazi.boyut`'u 64'e indirmeyi öner.

## 7. Masaüstü kısayolu
```powershell
$k = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\Afife Ofisi.lnk")
$k.TargetPath = "$PWD\Ofisi Ac.cmd"; $k.WorkingDirectory = "$PWD"; $k.Save()
```
Cem'e sor: "Zamanlanmış işler (sabah 08:00 video seçkisi, gece 00:00 reklam raporu) bilgisayar açıkken
ve ofis açıkken çalışır. Windows açılınca ofis kendiliğinden başlasın mı?" Evet derse aynı kısayolu
`shell:startup` klasörüne de koy.

## 8. Telefon bildirimi (isteğe bağlı)
Cem'e sor. İsterse: telefona ntfy uygulamasını kurmasını, `afife-` ile başlayan rastgele bir konu
adına (ör. `afife-ofis-` + 6 rastgele harf) abone olmasını söyle; aynı adı kullanıcı ortam değişkeni
olarak ayarla: `[Environment]::SetEnvironmentVariable('NTFY_KONU','<konu>','User')`.
Test: `Invoke-RestMethod "https://ntfy.sh/<konu>" -Method Post -Body 'Afife Ofisi bağlandı'`.

## 9. Eksik bilgiler
- `ajanlar\topluluk-yoneticisi\bilgi.md`: yaş grupları, gün/saat, ücretler. Cem'e sor, birlikte doldur.
- Google Sheets'te **Kayıtlar** ve **Gelir-Gider** tabloları var mı Drive bağlayıcısıyla bak; yoksa
  sütun önerisiyle oluşturmayı teklif et (oluşturmadan önce onay al).

## 10. KURULUM.md
video-kurgu'daki `KURULUM.md` biçimiyle yaz: kurulum tarihi ve bilgisayar, kurulan araçlar ve
sürümleri (tablo), bağlanan ve eksik bağlayıcılar, yaşanan sorunlar ve çözümleri, yapılan testler
ve sonuçları. Bu dosya varken bu beceri tekrar kendiliğinden çalışmaz.

Sonunda Cem'e tek paragraf özet ver: ofis nasıl açılır (masaüstündeki "Afife Ofisi"), neyin çalıştığı,
neyin eksik kaldığı.
