# ✋ Smart Hand Calculator

Veb-kamera orqali qo'l harakatlari bilan boshqariladigan kalkulyator. To'liq brauzerda ishlaydi, hech narsa o'rnatish shart emas.

**Sayt:** https://tolibj5j.github.io/smart-hand-calculator/

## Imkoniyatlar

1. **Chizish rejimi.** Ko'rsatkich barmoq bilan havoda misol yozasiz, "Yechish (AI)" tugmasi uni Google Gemini'ga yuboradi va javobni chiqaradi.
   - Faqat ko'rsatkich barmoq: yozish
   - Ko'rsatkich + o'rta barmoq: qalamni ko'tarish
2. **Ishoralar rejimi.** Ishorani yashil chiziq to'lguncha ushlab turing (standart 1 soniya, 0.5–2.5 s oralig'ida sozlanadi).
   Bir xil belgini ketma-ket kiritish uchun qo'lni tushiring yoki boshqa ishora ko'rsating. Xato kirsa, **⌫** bilan o'chiring.

   | Ishora | Belgi |
   |---|---|
   | Ko'tarilgan barmoqlar soni (bir qo'l) | 0–5 |
   | Ikki qo'ldagi barmoqlar yig'indisi | 6–9 |
   | 👍 Like | `+` |
   | Faqat jimjiloq | `−` |
   | 🤘 Rok | `×` |
   | 🤙 Shaka | `÷` |
   | L shakli (bosh + ko'rsatkich) | `=` |

3. **Oddiy kalkulyator** tugmalari.
4. Kamerani tanlash, oyna rejimi, tozalash.

## Foydalanish

1. Saytni oching va **"Kamerani yoqish"** ni bosing, brauzer so'raganda ruxsat bering.
2. AI uchun: **⚙️ Sozlamalar** → [Google AI Studio](https://aistudio.google.com/apikey) dan olingan kalitni kiriting → **Saqlash**.
   Kalit faqat sizning brauzeringizda (`localStorage`) saqlanadi.

## Texnologiyalar

- [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (JavaScript) — qo'lni aniqlash
- Google Gemini API — qo'lyozmani tanish
- Oddiy HTML, CSS, JavaScript (kutubxona va build talab qilinmaydi)

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `index.html`, `style.css` | Sahifa va dizayn |
| `js/app.js` | Kamera, chizish, ishoralar, kalkulyator, AI tugmasi |
| `js/gestures.js` | Barmoqlar holatini va ishoralarni aniqlash |
| `js/tracker.js` | MediaPipe modelini yuklash |
| `js/ai.js` | Gemini API so'rovi |
| `js/calculator.js` | `eval`siz xavfsiz hisoblash |
| `python-version/` | Kompyuterda ishlaydigan Python (desktop) versiyasi |

## Python versiyasi

```bash
cd python-version
pip install -r requirements.txt
set GEMINI_API_KEY=AIza...   # Linux/macOS: export GEMINI_API_KEY=...
python main.py
```
