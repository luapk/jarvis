// In-browser hand detection via MediaPipe. Reports the centre and radius (in
// video pixels) of each open palm facing the camera, so the HUD can place a
// circular tracking marker inside it. Cosmetic and best-effort: any failure
// simply means no palm markers.
import { HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { getVision } from "./vision.ts";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Palm marker in video pixels.
export interface Palm {
  x: number;
  y: number;
  radius: number;
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;

function getLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await getVision();
      return HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    })();
  }
  return landmarkerPromise;
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// An open palm has most fingers extended: each fingertip sits further from the
// wrist than its middle joint. Orientation-independent, so it works whichever
// way the hand is turned.
function isOpen(lm: NormalizedLandmark[]): boolean {
  const wrist = lm[0];
  const fingers: [number, number][] = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];
  let extended = 0;
  for (const [tip, pip] of fingers) {
    if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15) extended += 1;
  }
  return extended >= 3;
}

export function startHandTracking(
  video: HTMLVideoElement,
  onHands: (palms: Palm[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  let stopped = false;
  let raf = 0;
  let lastRun = 0;

  getLandmarker()
    .then((landmarker) => {
      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2 || video.videoWidth === 0) return;

        // Hands need less frequent updates than the face; run at about 10fps.
        const now = performance.now();
        if (now - lastRun < 100) return;
        lastRun = now;

        try {
          const result = landmarker.detectForVideo(video, now);
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const palms: Palm[] = [];
          for (const lm of result.landmarks ?? []) {
            if (lm.length < 21 || !isOpen(lm)) continue;
            // Palm centre: average of the wrist and the four finger knuckles.
            const idx = [0, 5, 9, 13, 17];
            let cx = 0;
            let cy = 0;
            for (const i of idx) {
              cx += lm[i].x;
              cy += lm[i].y;
            }
            cx = (cx / idx.length) * vw;
            cy = (cy / idx.length) * vh;
            // Radius from the palm centre to the middle knuckle, in pixels.
            const mx = lm[9].x * vw;
            const my = lm[9].y * vh;
            const radius = Math.hypot(mx - cx, my - cy) * 1.15;
            palms.push({ x: cx, y: cy, radius });
          }
          onHands(palms);
        } catch {
          // Skip this frame.
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
