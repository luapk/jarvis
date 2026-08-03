import { useCallback, useEffect, useRef, useState } from "react";
import { frameToBase64, observeFrame } from "./observer.ts";
import { initVoice, speak } from "./voice.ts";

type State = "STANDBY" | "READY" | "OBSERVING";

const AUTO_INTERVAL_MS = 8000;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Mutable values read inside timers and async callbacks. Kept in refs so the
  // auto-observe interval always sees the current value, never a stale closure.
  const busyRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const autoRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const typeTimerRef = useRef<number | null>(null);

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

  // Capture the current frame and send it for a remark. Never runs two calls at
  // once: if one is in flight, this returns immediately.
  const observe = useCallback(async () => {
    if (busyRef.current || !cameraReadyRef.current) return;
    const source = videoRef.current;
    if (!source) return;

    const data = frameToBase64(source);
    if (!data) {
      setStatus("No frame yet.");
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
      speak(line);
      setStatus("remark delivered.");
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
    }
  }, [typeCaption]);

  // (Re)start the auto-observe loop to match the current toggle.
  const startAuto = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoRef.current && cameraReadyRef.current) {
      timerRef.current = window.setInterval(observe, AUTO_INTERVAL_MS);
    }
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
          startAuto();
          window.setTimeout(observe, 900);
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
  }, [observe, startAuto, typeCaption]);

  const onToggleAuto = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      autoRef.current = event.target.checked;
      setAuto(event.target.checked);
      startAuto();
    },
    [startAuto],
  );

  // Clean up the camera stream and any timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
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
        <button onClick={observe} disabled={!cameraOn}>
          Observe now
        </button>
        <label className="toggle">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} /> auto-observe
          every 8s
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
