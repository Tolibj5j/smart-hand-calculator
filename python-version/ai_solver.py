"""Qo'lda yozilgan misolni Google Gemini orqali tanish va yechish."""

import os

import cv2
import numpy as np
from PIL import Image

# Modelni GEMINI_MODEL muhit o'zgaruvchisi orqali almashtirish mumkin
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")

PROMPT = (
    "The image contains a handwritten math expression (dark strokes on a white background). "
    "Recognize the expression and solve it. "
    "Reply STRICTLY in the format: expression = answer (for example: 2 + 2 = 4 or 5 * 10 = 50). "
    "Use only the symbols + - * / and digits. No extra words."
)

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai  # kalit bo'lmasa ham ilova ishga tushsin

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY o'rnatilmagan")
        _client = genai.Client(api_key=api_key)
    return _client


def prepare_image(canvas_bgr):
    """Holstni modelga qulay ko'rinishga keltiradi.

    - oq fonda qora yozuv (tanish osonroq)
    - bo'sh joylarni kesib tashlaymiz
    Holst ekranda qanday ko'rinsa, AI ham shunday ko'radi.
    """
    gray = cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2GRAY)

    ys, xs = np.nonzero(gray > 50)
    if len(xs) == 0:
        return None
    pad = 30
    y1, y2 = max(ys.min() - pad, 0), min(ys.max() + pad, gray.shape[0])
    x1, x2 = max(xs.min() - pad, 0), min(xs.max() + pad, gray.shape[1])

    return Image.fromarray(255 - gray[y1:y2, x1:x2])


def solve_from_image(canvas_bgr):
    img = prepare_image(canvas_bgr)
    if img is None:
        return "Holst bo'sh"
    try:
        response = _get_client().models.generate_content(model=MODEL, contents=[PROMPT, img])
        text = (response.text or "").strip()
        return text or "Tanib bo'lmadi"
    except Exception as e:
        print(f"Gemini xatosi: {type(e).__name__}: {e}")
        return "AI xatosi (konsolni qarang)"
