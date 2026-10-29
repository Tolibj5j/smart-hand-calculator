// Barmoqlar holati va ishoralarni aniqlash (kutubxonasiz, sof mantiq).

// Qo'l nuqtalari orasidagi bog'lanishlar (21 nuqta)
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Kalit: bosh, ko'rsatkich, o'rta, nomsiz, jimjiloq (1 - ko'tarilgan)
export const GESTURE_MAP = {
  "00000": "0",
  "01000": "1",
  "01100": "2",
  "01110": "3",
  "01111": "4",
  "11111": "5",
  "10000": "+", // Like
  "00001": "-", // Jimjiloq
  "01001": "*", // Rok
  "10001": "/", // Shaka
  "11000": "=", // L shakli
};

const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [uchi, o'rta bo'g'imi]

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** MediaPipe koordinatalarini (0..1) ekran piksellariga o'tkazadi. */
export function toPixels(landmarks, width, height, mirrored) {
  return landmarks.map((lm) => ({
    x: (mirrored ? 1 - lm.x : lm.x) * width,
    y: lm.y * height,
  }));
}

/**
 * Qaysi barmoqlar ko'tarilganini qaytaradi: [bosh, ko'rsatkich, o'rta, nomsiz, jimjiloq].
 * Masofaga asoslangan, shuning uchun qo'lning burilishi va chap/o'ng qo'l ahamiyatsiz.
 */
export function fingerState(p) {
  const wrist = p[0];
  const thumb = dist(p[4], p[17]) > dist(p[3], p[17]) * 1.1 ? 1 : 0;
  const rest = FINGERS.map(([tip, pip]) => (dist(p[tip], wrist) > dist(p[pip], wrist) ? 1 : 0));
  return [thumb, ...rest];
}

/**
 * Barmoq qanchalik to'g'ri: uchi bilan asosi orasidagi masofa / barmoq uzunligi.
 * 1.0 - butunlay tik, ~0.8 - yarim bukilgan, ~0.2 - musht.
 * Qo'l kattaligi, burilishi va kameradan uzoqligiga bog'liq emas.
 */
function straightness(p, mcp) {
  const [a, b, c, d] = [p[mcp], p[mcp + 1], p[mcp + 2], p[mcp + 3]];
  const length = dist(a, b) + dist(b, c) + dist(c, d);
  return dist(a, d) / Math.max(length, 1e-6);
}

/**
 * Chizish rejimi uchun qalam holati: "draw" (yozish), "hover" (qalam ko'tarilgan) yoki "none".
 * Ko'rsatkich uchun yumshoq chegara (biroz egilgan bo'lsa ham yozadi),
 * o'rta barmoq uchun qattiq chegara: u faqat aniq tik turganda qalam ko'tariladi.
 * Shunda yarim bukilgan o'rta barmoq chizishga xalaqit bermaydi.
 */
export function penState(p) {
  const indexUp = straightness(p, 5) > 0.6;
  const middleUp = straightness(p, 9) > 0.88;
  if (indexUp && middleUp) return "hover";
  if (indexUp) return "draw";
  return "none";
}

/** Bir qo'l: GESTURE_MAP bo'yicha. Ikki qo'l: barmoqlar yig'indisi 6-9. */
export function readGesture(hands) {
  if (hands.length === 1) {
    return GESTURE_MAP[fingerState(hands[0]).join("")] ?? null;
  }
  if (hands.length === 2) {
    const sum = (h) => fingerState(h).reduce((a, b) => a + b, 0);
    const total = sum(hands[0]) + sum(hands[1]);
    if (total >= 6 && total <= 9) return String(total);
  }
  return null;
}

/**
 * Ishoralardan belgi kiritishni boshqaradi. Tasodifiy kiritishlarning oldini oladi:
 *  1. Silliqlash: oxirgi `window` kadrdan kamida `minAgree` tasi bir xil bo'lsagina ishora hisoblanadi
 *     (bir ishoradan boshqasiga o'tishdagi oraliq holatlar va titrash e'tiborga olinmaydi).
 *  2. Ushlab turish: ishora `holdMs` davomida turishi kerak.
 *  3. Qulf: kiritilgandan keyin xuddi shu ishora qayta kiritilmaydi. Avval boshqa ishora
 *     ko'rsatish yoki qo'lni `releaseMs` davomida tushirish kerak.
 */
export class GestureInput {
  constructor({ holdMs = 1000, releaseMs = 400, graceMs = 200, window = 5, minAgree = 4 } = {}) {
    Object.assign(this, { holdMs, releaseMs, graceMs, window, minAgree });
    this.reset();
  }

  reset() {
    this.history = [];
    this.symbol = null;      // hozir ushlab turilgan ishora
    this.start = 0;
    this.lastSeen = 0;
    this.progress = 0;       // 0..1
    this.locked = null;      // oxirgi kiritilgan, hali qo'yib yuborilmagan ishora
    this.releaseStart = 0;
    this.lastInput = null;
    this.lastInputAt = -Infinity;
  }

  _stable() {
    const counts = new Map();
    for (const s of this.history) counts.set(s, (counts.get(s) || 0) + 1);
    for (const [s, n] of counts) if (n >= this.minAgree) return s;
    return null;
  }

  /** Har bir yangi kadrda chaqiriladi. Kiritilishi kerak bo'lgan belgini yoki null qaytaradi. */
  update(rawSymbol, now) {
    this.history.push(rawSymbol);
    if (this.history.length > this.window) this.history.shift();
    const stable = this._stable();

    // Qulf: oldingi ishora qo'yib yuborilishini kutamiz.
    // Boshqa barqaror ishora ko'rsatilsa - qulf darhol ochiladi,
    // qo'l tushirilsa (ishora yo'q) - releaseMs kutiladi.
    if (this.locked !== null) {
      if (stable === this.locked) {
        this.releaseStart = 0;
        this.symbol = null;
        this.progress = 0;
        return null;
      }
      if (stable === null) {
        if (!this.releaseStart) this.releaseStart = now;
        if (now - this.releaseStart < this.releaseMs) {
          this.symbol = null;
          this.progress = 0;
          return null;
        }
      }
      this.locked = null;
      this.releaseStart = 0;
    }

    if (stable && stable !== this.symbol) {
      this.symbol = stable;
      this.start = now;
    }
    if (stable && stable === this.symbol) {
      this.lastSeen = now;
    } else if (this.symbol && now - this.lastSeen > this.graceMs) {
      // Ishora yo'qoldi yoki noaniq bo'lib qoldi
      this.symbol = null;
    }

    if (!this.symbol) {
      this.progress = 0;
      return null;
    }

    this.progress = Math.min(1, (now - this.start) / this.holdMs);
    if (this.progress < 1) return null;

    const committed = this.symbol;
    this.locked = committed;
    this.lastInput = committed;
    this.lastInputAt = now;
    this.symbol = null;
    this.progress = 0;
    return committed;
  }
}
