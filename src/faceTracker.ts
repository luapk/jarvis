// In-browser face detection via MediaPipe. Runs a lightweight loop on the live
// video and reports the primary face's bounding box (in video pixels) so the
// HUD can lock onto it. Everything here is cosmetic: if the detector fails to
// load, the caller falls back to a centred scanning reticle and the observation
// loop is unaffected.
import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from "@mediapipe/tasks-vision";

// Pinned to the installed package version so the wasm matches the JS.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

// Face box in the video's own pixel space.
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

let detectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
      });
    })();
  }
  return detectorPromise;
}

// Start tracking. Calls onFace with the primary face box, or null when no face
// is visible. Returns a stop function. onError fires if the detector cannot
// load, so the caller can fall back.
export function startFaceTracking(
  video: HTMLVideoElement,
  onFace: (box: FaceBox | null) => void,
  onError?: (err: unknown) => void,
): () => void {
  let stopped = false;
  let raf = 0;
  let lastRun = 0;

  getDetector()
    .then((detector) => {
      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2 || video.videoWidth === 0) return;

        // Throttle to roughly 16 frames per second; detection need not run on
        // every animation frame.
        const now = performance.now();
        if (now - lastRun < 60) return;
        lastRun = now;

        try {
          const result = detector.detectForVideo(video, now);
          const best: Detection | undefined = result.detections?.[0];
          const bb = best?.boundingBox;
          if (bb) {
            onFace({
              x: bb.originX,
              y: bb.originY,
              width: bb.width,
              height: bb.height,
            });
          } else {
            onFace(null);
          }
        } catch {
          // Skip this frame; the next one will try again.
        }
      };
      raf = requestAnimationFrame(loop);
    })
    .catch((err) => {
      if (onError) onError(err);
    });

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
