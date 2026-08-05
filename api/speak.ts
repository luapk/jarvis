import type { VercelRequest, VercelResponse } from "@vercel/node";

// Proxies ElevenLabs text-to-speech so the ElevenLabs key is read server-side
// only and never reaches the browser. Returns MP3 audio on success. If the key
// is not configured, returns 501 so the client can fall back to the browser
// voice: the demo still works with only the Anthropic key set.

// The installation voice. Overridable, but defaults to the requested voice.
const DEFAULT_VOICE_ID = "4u5cJuSmHP9d6YRolsOu";
// eleven_multilingual_v2 favours quality; set ELEVENLABS_MODEL_ID to
// eleven_turbo_v2_5 or eleven_flash_v2_5 for lower latency before audio starts.
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
// Speaking pace. ElevenLabs accepts 0.7 (slow) to 1.2 (fast); default a touch
// quick. Override with ELEVENLABS_SPEED.
const DEFAULT_SPEED = 1.1;

function resolveSpeed(): number {
  const raw = Number.parseFloat(process.env.ELEVENLABS_SPEED ?? "");
  if (Number.isNaN(raw)) return DEFAULT_SPEED;
  return Math.min(1.2, Math.max(0.7, raw));
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // 501 signals "not configured" so the client falls back to browser speech.
    res.status(501).json({ error: "ElevenLabs is not configured." });
    return;
  }

  const text = (req.body as { text?: string } | undefined)?.text;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Request body must include text." });
    return;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          // Lower stability gives a livelier, more expressive read; speed sets
          // the pace; speaker boost keeps the voice's character.
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.75,
            speed: resolveSpeed(),
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      // Pass the real upstream status through so the client can tell a
      // permanent error (401 quota or bad key) from a transient one (429, 5xx)
      // and only retry the transient ones.
      res.status(upstream.status).json({
        error: `ElevenLabs returned ${upstream.status}: ${detail.slice(0, 300)}`,
      });
      return;
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(audio);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `ElevenLabs call failed: ${message}` });
  }
}
