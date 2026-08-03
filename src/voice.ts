// Speech output. Prefers the ElevenLabs installation voice via /api/speak, and
// falls back to the browser Web Speech API when ElevenLabs is not configured or
// a call fails. Every path resolves only when the line has finished being
// spoken, so the caller can measure silence from that point.

let voice: SpeechSynthesisVoice | null = null;
let currentAudio: HTMLAudioElement | null = null;

// Names commonly attached to en-GB voices across browsers and platforms, plus a
// straight lang check for anything tagged en-GB. Used for the browser fallback.
const PREFERRED = ["Daniel", "Arthur", "George", "Oliver", "Google UK English Male"];

function pickVoice(): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  for (const name of PREFERRED) {
    const match = voices.find(
      (v) => (v.name && v.name.includes(name)) || v.lang === "en-GB",
    );
    if (match) return match;
  }
  return voices.find((v) => v.lang && v.lang.startsWith("en")) ?? voices[0];
}

// Voices load asynchronously in most browsers, so refresh the choice on the
// onvoiceschanged event as well as on first call.
export function initVoice(): void {
  if (!("speechSynthesis" in window)) return;
  voice = pickVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    voice = pickVoice();
  };
}

// Stop anything currently speaking, on either path.
function stopCurrent(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// Play an object-URL clip to completion. Calls onStart the moment playback
// actually begins. Resolves true if it played, false if playback was blocked or
// errored (so the caller can fall back).
function playAudio(url: string, onStart: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safety);
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve(ok);
    };

    audio.onplaying = () => onStart();
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    // Safety net in case neither end event fires.
    const safety = window.setTimeout(() => finish(true), 60000);
    audio
      .play()
      .then(() => onStart())
      .catch(() => finish(false));
  });
}

// Try the ElevenLabs installation voice. Returns true if it spoke the line,
// false to fall back (not configured, call failed, or playback blocked).
async function speakViaElevenLabs(
  text: string,
  onStart: () => void,
): Promise<boolean> {
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    return await playAudio(URL.createObjectURL(blob), onStart);
  } catch {
    return false;
  }
}

// Browser Web Speech fallback. Calls onStart when the utterance begins.
// Resolves when it ends, with a safety timeout so a browser that never fires
// onend cannot stall the loop.
function speakViaBrowser(text: string, onStart: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      resolve();
    };

    const utterance = new SpeechSynthesisUtterance(text);
    if (!voice) voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.96;
    utterance.pitch = 0.9;
    utterance.volume = 1;
    utterance.onstart = () => onStart();
    utterance.onend = done;
    utterance.onerror = done;

    const fallback = window.setTimeout(done, Math.max(4000, text.length * 90));
    window.speechSynthesis.speak(utterance);
  });
}

// Speak the given line, ElevenLabs first then browser fallback, resolving when
// the line has finished. onStart fires when audio actually begins, so callers
// can reveal the caption in sync with the voice. It is always called at least
// once before resolving, so the caption still appears even if nothing spoke.
export async function speak(text: string, onStart?: () => void): Promise<void> {
  if (!text) return;
  stopCurrent();

  let started = false;
  const startOnce = () => {
    if (started) return;
    started = true;
    onStart?.();
  };

  const spoken = await speakViaElevenLabs(text, startOnce);
  if (!spoken) await speakViaBrowser(text, startOnce);
  startOnce();
}
