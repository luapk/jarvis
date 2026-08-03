// In-browser face detection via MediaPipe. Runs a lightweight loop on the live
// video and reports the primary face's bounding box and eye keypoints (in video
// pixels) so the HUD can lock onto the face and place eye graphics. Everything
// here is cosmetic: if the detector fails to load, the caller falls back to a
// centred scanning reticle and the observation loop is unaffected.
import { FaceDetector, type Detection } from "@mediapipe/tasks-vision";
import { getVision } from "./vision.ts";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export interface Point {
  x: number;
  y: number;
}

// Face box in the video's own pixel space.
export interface FaceBox extends Point {
  width: number;
  height: number;
}

export interface FaceResult {
  box: FaceBox;
  // Eye keypoints in video pixels: index 0 and 1 are the two eyes.
  eyes: Point[];
}

let detectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await getVision();
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
      });
    })();
  }
  return detectorPromise;
}

// Start tracking. Calls onFace with the primary face result, or null when no
// face is visible. Returns a stop function. onError fires if the detector
// cannot load, so the caller can fall back.
export function startFaceTracking(
  video: HTMLVideoElement,
  onFace: (result: FaceResult | null) => void,
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

        // Throttle to roughly 16 frames per second.
        const now = performance.now();
        if (now - lastRun < 60) return;
        lastRun = now;

        try {
          const result = detector.detectForVideo(video, now);
          const best: Detection | undefined = result.detections?.[0];
          const bb = best?.boundingBox;
          if (bb) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            // Keypoints are normalised (0 to 1); convert to video pixels.
            const eyes = (best?.keypoints ?? [])
              .slice(0, 2)
              .map((k) => ({ x: k.x * vw, y: k.y * vh }));
            onFace({
              box: {
                x: bb.originX,
                y: bb.originY,
                width: bb.width,
                height: bb.height,
              },
              eyes,
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
