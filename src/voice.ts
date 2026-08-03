// Web Speech API voice selection and speak(). Prefers a British English voice,
// falls back to any English voice, then to whatever is available.

let voice: SpeechSynthesisVoice | null = null;

// Names commonly attached to en-GB voices across browsers and platforms, plus a
// straight lang check for anything tagged en-GB.
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

// Cancel any in-progress utterance and speak the given line.
export function speak(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (!voice) voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.96;
  utterance.pitch = 0.9;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}
