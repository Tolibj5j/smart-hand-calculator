"""Qo'lni kuzatish: MediaPipe Tasks API (HandLandmarker) asosida.

Eski `mp.solutions.hands` API MediaPipe 0.10.31 dan boshlab olib tashlangan,
shuning uchun bu yerda yangi Tasks API ishlatiladi.
"""

import math
import os
import time
import urllib.request

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/latest/hand_landmarker.task"
)
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hand_landmarker.task")

# Qo'l nuqtalari orasidagi bog'lanishlar (21 nuqta)
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),          # bosh barmoq
    (0, 5), (5, 6), (6, 7), (7, 8),          # ko'rsatkich
    (5, 9), (9, 10), (10, 11), (11, 12),     # o'rta
    (9, 13), (13, 14), (14, 15), (15, 16),   # nomsiz
    (13, 17), (17, 18), (18, 19), (19, 20),  # jimjiloq
    (0, 17),
]

# Barmoq: (uchi, o'rta bo'g'imi)
FINGERS = {"index": (8, 6), "middle": (12, 10), "ring": (16, 14), "pinky": (20, 18)}

PEN_COLOR = (255, 255, 255)
PEN_THICKNESS = 15

# Kalit: (bosh, ko'rsatkich, o'rta, nomsiz, jimjiloq). 1 - ko'tarilgan, 0 - bukilgan.
GESTURE_MAP = {
    (0, 0, 0, 0, 0): "0",
    (0, 1, 0, 0, 0): "1",
    (0, 1, 1, 0, 0): "2",
    (0, 1, 1, 1, 0): "3",
    (0, 1, 1, 1, 1): "4",
    (1, 1, 1, 1, 1): "5",
    (1, 0, 0, 0, 0): "+",  # Like
    (0, 0, 0, 0, 1): "-",  # Jimjiloq
    (0, 1, 0, 0, 1): "*",  # Rok
    (1, 0, 0, 0, 1): "/",  # Shaka
    (1, 1, 0, 0, 0): "=",  # L shakli
}


def ensure_model(path=MODEL_PATH):
    """Model fayli bo'lmasa, uni bir marta yuklab oladi (~7.5 MB)."""
    if not os.path.exists(path):
        print("hand_landmarker.task yuklab olinmoqda...")
        urllib.request.urlretrieve(MODEL_URL, path)
    return path


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class HandTracker:
    def __init__(self, num_hands=2, confidence=0.7):
        options = vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=ensure_model()),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=num_hands,
            min_hand_detection_confidence=confidence,
            min_hand_presence_confidence=confidence,
            min_tracking_confidence=confidence,
        )
        self.landmarker = vision.HandLandmarker.create_from_options(options)
        self._last_ts = 0
        self.prev_point = None
        self.canvas = None

    # ---------- Barmoqlar holati ----------

    @staticmethod
    def finger_state(pts):
        """Qaysi barmoqlar ko'tarilganini aniqlaydi.

        Masofaga asoslangan, shuning uchun qo'l qaysi tomonga burilgani,
        chap yoki o'ng qo'l ekani va kadr aks ettirilgani ahamiyatsiz.
        """
        wrist = pts[0]
        state = []

        # Bosh barmoq: uchi jimjiloq asosidan (17) IP bo'g'imiga (3) qaraganda uzoqroq bo'lsa - ochiq
        thumb_open = _dist(pts[4], pts[17]) > _dist(pts[3], pts[17]) * 1.1
        state.append(1 if thumb_open else 0)

        # Qolgan barmoqlar: uchi bilakdan o'rta bo'g'imga qaraganda uzoqroq bo'lsa - ochiq
        for tip, pip in FINGERS.values():
            state.append(1 if _dist(pts[tip], wrist) > _dist(pts[pip], wrist) else 0)

        return tuple(state)

    # ---------- Asosiy ishlov ----------

    def _detect(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        # VIDEO rejimida vaqt belgisi qat'iy o'sib borishi shart
        ts = max(int(time.monotonic() * 1000), self._last_ts + 1)
        self._last_ts = ts
        return self.landmarker.detect_for_video(mp_image, ts)

    @staticmethod
    def _draw_hand(frame, pts):
        for a, b in HAND_CONNECTIONS:
            cv2.line(frame, pts[a], pts[b], (255, 255, 255), 2)
        for p in pts:
            cv2.circle(frame, p, 4, (0, 0, 255), cv2.FILLED)

    def process_frame(self, frame, mode="DRAW"):
        """Kadrni qayta ishlaydi. Qaytaradi: (kadr, holst, aniqlangan_belgi)."""
        h, w = frame.shape[:2]
        if self.canvas is None or self.canvas.shape != frame.shape:
            self.canvas = np.zeros_like(frame)

        result = self._detect(frame)
        hands = [[(int(lm.x * w), int(lm.y * h)) for lm in hand] for hand in result.hand_landmarks]

        for pts in hands:
            self._draw_hand(frame, pts)

        symbol = None
        if mode == "DRAW":
            self._handle_drawing(frame, hands)
            frame = self._overlay_canvas(frame)
        else:
            self.prev_point = None
            symbol = self._read_gesture(hands)
            cv2.putText(frame, "Like(+) Pinky(-) Rock(*) Shaka(/) L(=)  2 hands: 6-9",
                        (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        return frame, self.canvas, symbol

    def _handle_drawing(self, frame, hands):
        if not hands:
            self.prev_point = None  # qo'l yo'qolsa, chiziq uzilsin
            return

        pts = hands[0]
        _, index_up, middle_up, _, _ = self.finger_state(pts)
        tip = pts[8]

        if index_up and middle_up:
            # Qalam ko'tarilgan - faqat ko'rsatkich
            self.prev_point = None
            mid = ((pts[8][0] + pts[12][0]) // 2, (pts[8][1] + pts[12][1]) // 2)
            cv2.circle(frame, mid, 15, (0, 255, 0), cv2.FILLED)
        elif index_up:
            cv2.circle(frame, tip, 15, (0, 0, 255), cv2.FILLED)
            start = self.prev_point or tip
            cv2.line(self.canvas, start, tip, PEN_COLOR, PEN_THICKNESS)
            self.prev_point = tip
        else:
            self.prev_point = None

    def _read_gesture(self, hands):
        if len(hands) == 1:
            return GESTURE_MAP.get(self.finger_state(hands[0]))
        if len(hands) == 2:
            total = sum(self.finger_state(hands[0])) + sum(self.finger_state(hands[1]))
            if 6 <= total <= 9:
                return str(total)
        return None

    def _overlay_canvas(self, frame):
        gray = cv2.cvtColor(self.canvas, cv2.COLOR_BGR2GRAY)
        _, mask_inv = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)
        frame = cv2.bitwise_and(frame, cv2.cvtColor(mask_inv, cv2.COLOR_GRAY2BGR))
        return cv2.bitwise_or(frame, self.canvas)

    def clear_canvas(self):
        if self.canvas is not None:
            self.canvas = np.zeros_like(self.canvas)
        self.prev_point = None

    def close(self):
        self.landmarker.close()
