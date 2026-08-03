// Frame capture, downscale, encode, and the fetch to the serverless function.
// The live camera frame is drawn to a canvas, downscaled, and encoded to JPEG.

const MAX_WIDTH = 768;
const JPEG_QUALITY = 0.7;

// Draw the given source to a canvas, downscale to MAX_WIDTH, and return the
// base64 JPEG payload with the "data:" prefix stripped. Returns null if the
// source has no intrinsic dimensions yet (camera still warming up, etc.).
export function frameToBase64(
  source: HTMLVideoElement | HTMLImageElement,
): string | null {
  const w =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source.naturalWidth;
  const h =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source.naturalHeight;
  if (!w || !h) return null;

  const scale = Math.min(1, MAX_WIDTH / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

// POST a base64 frame to the serverless function and return the spoken line.
// Throws with a readable message on any non-ok response so the caller can show
// a status line rather than crashing.
export async function observeFrame(image: string): Promise<string> {
  const res = await fetch("/api/observe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && body.error) detail = body.error;
    } catch {
      // Response was not JSON. Keep the status-code detail.
    }
    throw new Error(detail);
  }

  const body = (await res.json()) as { line?: string };
  return (body.line ?? "").trim();
}
