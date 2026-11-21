# Model Stüdyo: kendi AI sunucunuz (ücretsiz)

Uygulamadaki **"Bu cihazda"** modu hiçbir kurulum istemez. Fotoğraflardaki dış hatlardan (silüetten)
model çıkarır. Araba, vazo, kutu ya da oyuncak gibi kaba hacimler için iyi sonuç verir.
Yüz, göz, kıyafet kıvrımı gibi **ince detaylar** için bu klasördeki AI sunucusunu kullanın.

- Model: **Tencent Hunyuan3D-2mv** (açık kaynak; ön/arka/sol/sağ görsellerden 3D üretir)
- Ücret yok, hesap yok, API anahtarı yok. Her şey sizin bilgisayarınızda (veya sizin Colab oturumunuzda) çalışır.
- Çıktı: 3D baskıya hazır **STL** (milimetre, Z yukarı, tek parça).

> Lisans: Hunyuan3D-2 "Tencent Hunyuan Community License" ile dağıtılıyor. Kişisel ve ticari
> kullanım belirli sınırlar içinde serbest, ancak AB, Birleşik Krallık ve Güney Kore'de kullanım
> lisans dışında. Ayrıntılar: https://github.com/Tencent/Hunyuan3D-2

---

## Seçenek A: Kendi bilgisayarınız (NVIDIA ekran kartı)

Gereken: NVIDIA ekran kartı (8 GB+ VRAM önerilir), Python 3.10, güncel NVIDIA sürücüsü, ~15 GB boş disk.

```bash
# 1) Hunyuan3D-2'yi kurun
git clone https://github.com/Tencent/Hunyuan3D-2
cd Hunyuan3D-2
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
pip install -e .

# 2) Sunucu eklerini kurun (bu klasördeki dosya)
pip install -r <AEFGP.github.io>/model-studio/server/requirements.txt

# 3) Çalıştırın (ilk açılışta model indirilir, birkaç GB)
python <AEFGP.github.io>/model-studio/server/app.py
```

Sonra:
- **Bilgisayarda:** tarayıcıda `http://localhost:8000` adresini açın.
- **Telefonda (aynı Wi-Fi):** `http://<bilgisayarın-IP-adresi>:8000` adresini açın. IP'yi Windows'ta
  `ipconfig`, Mac/Linux'ta `ip a` komutuyla görebilirsiniz.
- **Görselden 3D → Kendi AI sunucum** seçin, fotoğrafları ekleyin, **3D Model Oluştur** deyin. Üretim 1–3 dakika sürer.

Daha hızlı ama biraz daha düşük kalite için: `python app.py --subfolder hunyuan3d-dit-v2-mv-turbo`

## Seçenek B: Google Colab (ekran kartı gerekmez, ücretsiz)

1. https://colab.research.google.com adresinde yeni bir not defteri açın.
   **Çalışma zamanı → Çalışma zamanı türünü değiştir → T4 GPU** seçin.
2. Aşağıdaki hücreleri sırayla çalıştırın:

```python
!git clone https://github.com/Tencent/Hunyuan3D-2
%cd Hunyuan3D-2
!pip install -q -r requirements.txt && pip install -q -e .
!pip install -q fastapi uvicorn python-multipart trimesh networkx scipy
```

```python
# Sunucu dosyasını sitenizden indirin (adresi kendi GitHub Pages adresinizle değiştirin)
!wget -q -O app.py https://<SITE-ADRESINIZ>/model-studio/server/app.py
# Herkese açık geçici bir https adresi için cloudflared
!wget -q -O cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared
!nohup ./cloudflared tunnel --url http://localhost:8000 > tunnel.log 2>&1 &
```

```python
!sleep 8 && grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1
!python app.py --port 8000
```

3. Çıkan `https://....trycloudflare.com` adresini kopyalayın. Telefon veya PC'den Model Stüdyo'yu
   (GitHub Pages sitenizdeki) açın, **Kendi AI sunucum → Sunucu adresi** kutusuna yapıştırın.

Not: Colab'ın ücretsiz GPU süresi sınırlıdır. Oturum kapanınca adres de değişir.

---

## Sorun giderme

| Durum | Çözüm |
|---|---|
| Sol ve sağ ters çıktı | Sunucuyu `--swap-lr` ile başlatın. |
| "Sunucuya bağlanılamadı" | Sunucu açık mı? Telefon ve PC aynı Wi-Fi'da mı? Windows Güvenlik Duvarı 8000 portuna izin veriyor mu? |
| Ekran kartı belleği yetmiyor (CUDA out of memory) | Kalite'yi "Normal" yapın veya `--subfolder hunyuan3d-dit-v2-mv-turbo` kullanın. |
| AI'sız deneme | `python app.py --mock`: model yüklemez, test şekli döndürür. Bağlantıyı denemek içindir. |

## API

`POST /generate` (multipart): `front` (zorunlu), `back`, `left`, `right` görselleri;
`octree_resolution` (256/380/512), `steps` (30/50), `height_mm`, `seed`.
Yanıt: binary STL. `GET /health` sunucu durumunu verir.
