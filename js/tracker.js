// MediaPipe HandLandmarker'ni brauzerda yuklash.
import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

export async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  // Avval GPU, ishlamasa CPU
  for (const delegate of ["GPU", "CPU"]) {
    try {
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });
    } catch (err) {
      if (delegate === "CPU") throw err;
      console.warn("GPU ishlamadi, CPU ga o'tilmoqda:", err);
    }
  }
}
