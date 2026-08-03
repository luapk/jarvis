import { FilesetResolver } from "@mediapipe/tasks-vision";

// Shared MediaPipe wasm loader, so the face and hand detectors do not each fetch
// the runtime. Pinned to the installed package version.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";

let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

export function getVision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(WASM_BASE);
  }
  return visionPromise;
}
