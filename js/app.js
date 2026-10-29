import { HAND_CONNECTIONS, GestureInput, fingerState, readGesture, toPixels } from "./gestures.js";
import { safeEval, CalcError } from "./calculator.js";
import { solveImage, DEFAULT_MODEL } from "./ai.js";

const DEFAULT_HOLD_MS = 1000; // ishorani qancha ushlab turish kerak (sozlanadi)
const PEN_WIDTH = 15;
const SYMBOL_LABELS = { "*": "×", "/": "÷", "-": "−" };
const OPERATORS = "+-*/";

const $ = (id) => document.getElementById(id);
const video = $("video");
const view = $("view");
const ctx = view.getContext("2d");
const display = $("display");

const state = {
  mode: "DRAW",
  mirrored: true,
  landmarker: null,
  stream: null,
  lastVideoTime: -1,
  hands: [],
  strokes: [],         // chiziqlar: [{x, y}] massivlari, koordinatalar 0..1
  currentStroke: null,
  marker: null,        // barmoq uchidagi doira
  gesture: new GestureInput({ holdMs: Number(localStorage.getItem("shc_hold_ms")) || DEFAULT_HOLD_MS }),
  aiBusy: false,
  showingMessage: false,
};

// ================= Kalkulyator =================

function setDisplay(text, isMessage = false) {
  display.value = text;
  state.showingMessage = isMessage;
}

function calcInput(char) {
  let current = display.value.trim();
  if (state.showingMessage) {
    current = "";
    state.showingMessage = false;
  }

  if (char === "C") return setDisplay("");

  if (char === "⌫") {
    // Natija ko'rsatilgan bo'lsa, misolning o'zini qaytaramiz
    if (current.includes("=")) return setDisplay(current.split("=")[0].trim());
    return setDisplay(current.slice(0, -1));
  }

  if (char === "=") {
    if (!current || current.includes("=")) return;
    try {
      setDisplay(`${current} = ${safeEval(current)}`);
    } catch (err) {
      const div0 = err instanceof CalcError && err.message === "DIV0";
      setDisplay(div0 ? "0 ga bo'lib bo'lmaydi" : "Xato", true);
    }
    return;
  }

  if (current.includes("=")) {
    // Natijadan keyin: amal bosilsa natija bilan davom etadi, raqam bosilsa yangi misol
    const result = current.split("=").pop().trim();
    current = OPERATORS.includes(char) ? result : "";
  }
  setDisplay(current + char);
}

function buildKeys() {
  const keys = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "C", "0", "=", "+", "⌫"];
  const box = $("keys");
  for (const k of keys) {
    const b = document.createElement("button");
    b.textContent = SYMBOL_LABELS[k] ?? k;
    if (OPERATORS.includes(k)) b.className = "op";
    if (k === "C") b.className = "clear";
    if (k === "=") b.className = "eq";
    if (k === "⌫") {
      b.className = "back";
      b.title = "Oxirgi belgini o'chirish";
    }
    b.addEventListener("click", () => calcInput(k));
    box.appendChild(b);
  }
  display.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      calcInput("=");
    }
  });
  display.addEventListener("input", () => (state.showingMessage = false));
}

// ================= Kamera =================

async function startCamera(deviceId) {
  state.stream?.getTracks().forEach((t) => t.stop());
  const size = { width: { ideal: 640 }, height: { ideal: 480 } };
  const constraints = {
    audio: false,
    video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: "user", ...size },
  };
  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = state.stream;
  await video.play();
  state.lastVideoTime = -1;
}

async function fillCameraList() {
  const select = $("cameraSelect");
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const activeId = state.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  select.innerHTML = "";
  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Kamera ${i}`;
    if (d.deviceId === activeId) opt.selected = true;
    select.appendChild(opt);
  });
}

async function onCameraChange(e) {
  try {
    await startCamera(e.target.value);
  } catch (err) {
    console.error(err);
    setDisplay("Kamera ochilmadi", true);
    await startCamera().catch(() => {});
    await fillCameraList();
  }
}

function cameraErrorText(err) {
  if (!window.isSecureContext) return "Kamera faqat https:// orqali ishlaydi.";
  if (err?.name === "NotAllowedError") return "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.";
  if (err?.name === "NotFoundError") return "Kamera topilmadi.";
  if (err?.name === "NotReadableError") return "Kamera boshqa dastur tomonidan band.";
  return `Xato: ${err?.message || err}`;
}

async function start() {
  const btn = $("startBtn");
  const status = $("status");
  btn.disabled = true;
  try {
    status.textContent = "Kamera yoqilmoqda...";
    await startCamera();
    await fillCameraList();
    status.textContent = "Qo'l modeli yuklanmoqda (bir necha soniya)...";
    // MediaPipe CDN'dan yuklanadi; ishlamasa ham kalkulyator ishlayveradi
    const { createHandLandmarker } = await import("./tracker.js");
    state.landmarker = await createHandLandmarker();
    $("startOverlay").classList.add("hidden");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    status.textContent = state.stream ? `Model yuklanmadi: ${err?.message || err}` : cameraErrorText(err);
    btn.disabled = false;
  }
}

// ================= Chizish =================

function handleDrawing(hands, w, h) {
  state.marker = null;
  if (!hands.length) {
    state.currentStroke = null; // qo'l yo'qolsa, chiziq uziladi
    return;
  }
  const p = hands[0];
  const [, indexUp, middleUp] = fingerState(p);

  if (indexUp && middleUp) {
    state.currentStroke = null;
    state.marker = { x: (p[8].x + p[12].x) / 2, y: (p[8].y + p[12].y) / 2, color: "#00ff00" };
  } else if (indexUp) {
    if (!state.currentStroke) {
      state.currentStroke = [];
      state.strokes.push(state.currentStroke);
    }
    state.currentStroke.push({ x: p[8].x / w, y: p[8].y / h });
    state.marker = { x: p[8].x, y: p[8].y, color: "#ff0000" };
  } else {
    state.currentStroke = null;
  }
}

function drawStrokes(c, w, h, color, offsetX = 0, offsetY = 0) {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = PEN_WIDTH;
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const stroke of state.strokes) {
    if (stroke.length === 1) {
      c.beginPath();
      c.arc(stroke[0].x * w - offsetX, stroke[0].y * h - offsetY, PEN_WIDTH / 2, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.beginPath();
    stroke.forEach((pt, i) => {
      const x = pt.x * w - offsetX;
      const y = pt.y * h - offsetY;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();
  }
}

function clearBoard() {
  state.strokes = [];
  state.currentStroke = null;
  setDisplay("");
}

// ================= Ishoralar =================

function handleGesture(hands, now) {
  const symbol = state.gesture.update(readGesture(hands), now);
  if (symbol) calcInput(symbol);
}

function drawGestureOverlay(w, h) {
  const g = state.gesture;
  const label = (s) => SYMBOL_LABELS[s] ?? s;
  const now = performance.now();

  ctx.font = "bold 30px system-ui, sans-serif";
  if (g.symbol) {
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 200, 20);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(20, 20, 200 * g.progress, 20);
    ctx.fillText(`Kiritish: ${label(g.symbol)}`, 20, 76);
  } else if (g.locked !== null) {
    if (now - g.lastInputAt < 700) {
      ctx.fillStyle = "#00ff00";
      ctx.fillText(`✓ ${label(g.locked)} qo'shildi`, 20, 50);
    } else {
      ctx.fillStyle = "#ffaa00";
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText("Keyingi belgi uchun qo'lni tushiring", 20, 45);
      ctx.fillText("yoki boshqa ishora ko'rsating", 20, 72);
    }
  }
  ctx.fillStyle = "#ffff00";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("👍 +   🤙 ÷   🤘 ×   jimjiloq −   L =   2 qo'l: 6–9", 10, h - 16);
}

// ================= Asosiy sikl =================

function drawHands(hands) {
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  for (const p of hands) {
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(p[a].x, p[a].y);
      ctx.lineTo(p[b].x, p[b].y);
    }
    ctx.stroke();
    ctx.fillStyle = "#ff3030";
    for (const pt of p) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function loop() {
  if (video.readyState >= 2 && video.videoWidth) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }

    const now = performance.now();
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = state.landmarker.detectForVideo(video, now);
      state.hands = result.landmarks.map((lms) => toPixels(lms, w, h, state.mirrored));
      if (state.mode === "DRAW") handleDrawing(state.hands, w, h);
      else handleGesture(state.hands, now);
    }

    // Video kadri
    ctx.save();
    if (state.mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    if (state.mode === "DRAW") drawStrokes(ctx, w, h, "#ffffff");
    drawHands(state.hands);

    if (state.mode === "DRAW" && state.marker) {
      ctx.fillStyle = state.marker.color;
      ctx.beginPath();
      ctx.arc(state.marker.x, state.marker.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.mode === "GESTURE") drawGestureOverlay(w, h);
  }
  requestAnimationFrame(loop);
}

// ================= Sun'iy intellekt =================

/** Chizmani oq fonda qora yozuvli, kesilgan PNG ga aylantiradi. */
function renderForAI() {
  const w = view.width;
  const h = view.height;
  const pts = state.strokes.flat();
  if (!pts.length || !w) return null;

  const pad = PEN_WIDTH + 25;
  const xs = pts.map((p) => p.x * w);
  const ys = pts.map((p) => p.y * h);
  const x1 = Math.max(Math.min(...xs) - pad, 0);
  const y1 = Math.max(Math.min(...ys) - pad, 0);
  const x2 = Math.min(Math.max(...xs) + pad, w);
  const y2 = Math.min(Math.max(...ys) + pad, h);

  const out = document.createElement("canvas");
  out.width = Math.max(Math.round(x2 - x1), 64);
  out.height = Math.max(Math.round(y2 - y1), 64);
  const c = out.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, out.width, out.height);
  drawStrokes(c, w, h, "#000000", x1, y1);
  return out.toDataURL("image/png").split(",")[1];
}

async function solveAI() {
  if (state.aiBusy) return;
  const apiKey = localStorage.getItem("shc_api_key");
  if (!apiKey) {
    $("settings").open = true;
    $("apiKey").focus();
    return setDisplay("Avval API kalitni kiriting", true);
  }
  const image = renderForAI();
  if (!image) return setDisplay("Holst bo'sh", true);

  state.aiBusy = true;
  updateButtons();
  setDisplay("Tanilmoqda...", true);
  try {
    const model = localStorage.getItem("shc_model") || DEFAULT_MODEL;
    const text = await solveImage(image, apiKey, model);
    setDisplay(text, !text.includes("="));
  } catch (err) {
    console.error("Gemini xatosi:", err);
    setDisplay(`AI xatosi: ${err.message}`, true);
  } finally {
    state.aiBusy = false;
    updateButtons();
  }
}

// ================= Tugmalar =================

function updateButtons() {
  const mirror = $("mirrorBtn");
  mirror.textContent = state.mirrored ? "Oyna: YONIQ" : "Oyna: O'CHIQ";
  mirror.className = `btn ${state.mirrored ? "blue" : "gray"}`;

  const mode = $("modeBtn");
  const drawing = state.mode === "DRAW";
  mode.textContent = drawing ? "Rejim: CHIZISH" : "Rejim: ISHORALAR";
  mode.className = `btn ${drawing ? "purple" : "orange"}`;

  $("solveBtn").disabled = !drawing || state.aiBusy;
  $("help").style.visibility = drawing ? "visible" : "hidden";
}

function initSettings() {
  $("apiKey").value = localStorage.getItem("shc_api_key") || "";
  $("model").value = localStorage.getItem("shc_model") || DEFAULT_MODEL;
  $("saveSettings").addEventListener("click", () => {
    const key = $("apiKey").value.trim();
    const model = $("model").value.trim() || DEFAULT_MODEL;
    key ? localStorage.setItem("shc_api_key", key) : localStorage.removeItem("shc_api_key");
    localStorage.setItem("shc_model", model);
    $("model").value = model;
    $("settings").open = false;
    setDisplay(key ? "Sozlamalar saqlandi" : "API kalit o'chirildi", true);
  });
}

function initHoldSlider() {
  const slider = $("holdSlider");
  const value = $("holdValue");
  const show = () => (value.textContent = `${(state.gesture.holdMs / 1000).toFixed(1)} s`);
  slider.value = state.gesture.holdMs;
  show();
  slider.addEventListener("input", () => {
    state.gesture.holdMs = Number(slider.value);
    localStorage.setItem("shc_hold_ms", slider.value);
    show();
  });
}

function init() {
  buildKeys();
  initSettings();
  initHoldSlider();
  updateButtons();

  $("startBtn").addEventListener("click", start);
  $("cameraSelect").addEventListener("change", onCameraChange);
  $("clearBtn").addEventListener("click", clearBoard);
  $("solveBtn").addEventListener("click", solveAI);
  $("mirrorBtn").addEventListener("click", () => {
    state.mirrored = !state.mirrored;
    clearBoard(); // eski chizma teskari bo'lib qolmasin
    updateButtons();
  });
  $("modeBtn").addEventListener("click", () => {
    state.mode = state.mode === "DRAW" ? "GESTURE" : "DRAW";
    state.currentStroke = null;
    state.gesture.reset();
    updateButtons();
  });

  if (!navigator.mediaDevices?.getUserMedia) {
    $("status").textContent = cameraErrorText(new Error("Brauzer kamerani qo'llamaydi"));
    $("startBtn").disabled = true;
  }
}

init();
