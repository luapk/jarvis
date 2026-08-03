import { useCallback, useEffect, useRef, useState } from "react";
import { frameToBase64, observeFrame } from "./observer.ts";
import { initVoice, speak } from "./voice.ts";

type State = "STANDBY" | "READY" | "OBSERVING";

// Silence to hold after a spoken remark finishes, before the next scan begins.
const SILENCE_MS = 10000;
// Short delay before the very first scan, once the camera is live.
const FIRST_SCAN_MS = 900;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Mutable values read inside timers and async callbacks. Kept in refs so the
  // scheduling loop always sees the current value, never a stale closure.
  const busyRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const autoRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const typeTimerRef = useRef<number | null>(null);
  // Holds the latest observe function so the timer chain and callbacks can call
  // it without a circular useCallback dependency.
  const observeRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const [state, setState] = useState<State>("STANDBY");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("SUBJECT: NONE");
  const [analysing, setAnalysing] = useState(false);
  const [caption, setCaption] = useState("Awaiting a subject. Do step into the light.");
  const [auto, setAuto] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);

  useEffect(() => {
    initVoice();
  }, []);

  const typeCaption = useCallback((text: string) => {
    if (typeTimerRef.current !== null) window.clearInterval(typeTimerRef.current);
    let i = 0;
    setCaption("");
    typeTimerRef.current = window.setInterval(() => {
      i += 1;
      setCaption(text.slice(0, i));
      if (i >= text.length && typeTimerRef.current !== null) {
        window.clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    }, 18);
  }, []);

  // Schedule the next scan after the given delay, but only while auto-observe is
  // on and the camera is live. Always clears any pending timer first, so there
  // is never more than one scan queued.
  const scheduleNext = useCallback((delay: number) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (autoRef.current && cameraReadyRef.current) {
      timerRef.current = window.setTimeout(() => {
        void observeRef.current();
      }, delay);
    }
  }, []);

  // Capture the current frame and send it for a remark. Never runs two calls at
  // once. When it finishes, it waits for the spoken line to end and then holds
  // SILENCE_MS of silence before queueing the next scan.
  const observe = useCallback(async () => {
    if (busyRef.current || !cameraReadyRef.current) return;
    const source = videoRef.current;
    const data = source ? frameToBase64(source) : null;
    if (!data) {
      setStatus("No frame yet.");
      scheduleNext(1000);
      return;
    }

    busyRef.current = true;
    setAnalysing(true);
    setState("OBSERVING");
    setTag("SUBJECT: ACQUIRED");
    setStatus("analysing frame...");

    try {
      let line = await observeFrame(data);
      if (!line) line = "I find myself with remarkably little to say. A rare event.";
      typeCaption(line);
      setStatus("remark delivered.");
      // Wait for the voice to finish so the silence is measured from there.
      await speak(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface the failure in the caption itself, not just the status line, so
      // the cause (for example a missing server key) is impossible to miss.
      typeCaption("A momentary lapse. " + message);
      setStatus("Model call failed: " + message);
    } finally {
      busyRef.current = false;
      setAnalysing(false);
      setState("READY");
      // Hold ten seconds of silence, then scan again.
      scheduleNext(SILENCE_MS);
    }
  }, [typeCaption, scheduleNext]);

  // Keep the ref pointed at the latest observe for the timer chain to call.
  useEffect(() => {
    observeRef.current = observe;
  }, [observe]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      typeCaption("This browser will not grant me a camera. A pity.");
      setStatus("getUserMedia unavailable in this browser.");
      return;
    }
    setStatus("requesting camera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        const begin = () => {
          cameraReadyRef.current = true;
          scheduleNext(FIRST_SCAN_MS);
        };
        // onloadedmetadata may have already fired if the stream attached fast,
        // so start the loop directly when metadata is present.
        if (video.readyState >= 1) begin();
        else video.onloadedmetadata = begin;
        // Prompt playback explicitly; some browsers do not autoplay reliably.
        void video.play().catch(() => undefined);
      }
      setCameraOn(true);
      setState("READY");
      setStatus("camera live.");
    } catch (err) {
      const name = err instanceof Error ? err.name : "error";
      const message = err instanceof Error ? err.message : String(err);
      typeCaption("The camera is denied to me here (" + name + ").");
      setStatus("Camera error: " + name + " " + message);
    }
  }, [scheduleNext, typeCaption]);

  const onToggleAuto = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const checked = event.target.checked;
      autoRef.current = checked;
      setAuto(checked);
      // Turning it on resumes the loop after the usual silence; turning it off
      // clears the pending scan (scheduleNext leaves the timer cleared when
      // auto is off).
      scheduleNext(SILENCE_MS);
    },
    [scheduleNext],
  );

  // Clean up the camera stream and any timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (typeTimerRef.current !== null) window.clearInterval(typeTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <>
      <div className="head">
        <div className="brand">
          <span className="dot" /> J.A.R.V.I.S. // OBSERVER
        </div>
        <div className="state">{state}</div>
      </div>

      <div className={"stage" + (analysing ? " analysing" : "")}>
        <video ref={videoRef} autoPlay playsInline muted />
        <div className="hud">
          <div className="tag">{tag}</div>
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <div className="reticle" />
          <div className="scanline" />
          <div className="caption">
            <span>{caption}</span>
            <span className="cursor" />
          </div>
        </div>
      </div>

      <div className="controls">
        <button className="primary" onClick={startCamera}>
          {cameraOn ? "Camera on" : "Start camera"}
        </button>
        <button onClick={() => void observe()} disabled={!cameraOn}>
          Observe now
        </button>
        <label className="toggle">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} /> auto-observe
        </label>
      </div>

      <div className="status">{status}</div>

      <div className="note">
        <b>Concept demo.</b> Original British-AI register and the browser's own
        voice, not an impersonation. It remarks only on clothing, colour,
        objects, posture, pace and setting, never on a person's body or
        identity, which is the same rule that keeps it in character. No frame is
        stored, logged, or sent anywhere except the single model call. On a real
        installation this runs behind a moderated feed with a kill switch, and
        the JARVIS name and voice would need Marvel and talent clearance.
      </div>
    </>
  );
}
