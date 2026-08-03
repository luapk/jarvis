import { useCallback, useEffect, useRef, useState } from "react";
import { frameToBase64, observeFrame } from "./observer.ts";
import { initVoice, speak } from "./voice.ts";
import { startFaceTracking, type FaceBox } from "./faceTracker.ts";

type State = "STANDBY" | "READY" | "OBSERVING";
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Silence to hold after a spoken remark finishes, before the next scan begins.
const SILENCE_MS = 10000;
// Short delay before the very first scan, once the camera is live.
const FIRST_SCAN_MS = 900;
// How long to keep the lock frame after a face momentarily drops out.
const LOCK_GRACE_MS = 700;

// Map a face box (video pixels) to a rectangle in the stage, accounting for the
// object-fit: cover crop and the mirrored (scaleX(-1)) video, and padded so the
// lock frame sits around the face rather than on it.
function mapFaceToStage(
  box: FaceBox,
  video: HTMLVideoElement,
  stage: HTMLElement,
): Rect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (!vw || !vh || !sw || !sh) return null;

  const scale = Math.max(sw / vw, sh / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const ox = (sw - dispW) / 2;
  const oy = (sh - dispH) / 2;

  const left = ox + box.x * scale;
  const top = oy + box.y * scale;
  const width = box.width * scale;
  const height = box.height * scale;

  const mirroredLeft = sw - (left + width);
  const padX = width * 0.22;
  const padY = height * 0.28;

  return {
    left: mirroredLeft - padX,
    top: top - padY,
    width: width + padX * 2,
    height: height + padY * 2,
  };
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Mutable values read inside timers and async callbacks. Kept in refs so the
  // scheduling loop always sees the current value, never a stale closure.
  const busyRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const autoRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const typeTimerRef = useRef<number | null>(null);
  const observeRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const trackerStopRef = useRef<(() => void) | null>(null);
  const loseTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<State>("STANDBY");
  const [status, setStatus] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [caption, setCaption] = useState("Awaiting a subject. Do step into the light.");
  const [auto, setAuto] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [faceRect, setFaceRect] = useState<Rect | null>(null);
  const [clock, setClock] = useState("00:00:00");

  useEffect(() => {
    initVoice();
  }, []);

  // Telemetry clock.
  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const tick = () => {
      const d = new Date();
      setClock(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
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
  // on and the camera is live. Always clears any pending timer first.
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
    setStatus("analysing frame...");

    try {
      let line = await observeFrame(data);
      if (!line) line = "I find myself with remarkably little to say. A rare event.";
      setStatus("remark delivered.");
      // Reveal the caption only when the voice actually begins, and wait for the
      // voice to finish so the silence is measured from there.
      await speak(line, () => typeCaption(line));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      typeCaption("A momentary lapse. " + message);
      setStatus("Model call failed: " + message);
    } finally {
      busyRef.current = false;
      setAnalysing(false);
      setState("READY");
      scheduleNext(SILENCE_MS);
    }
  }, [typeCaption, scheduleNext]);

  useEffect(() => {
    observeRef.current = observe;
  }, [observe]);

  // Begin face tracking on the live video. Purely cosmetic: on any failure the
  // HUD simply falls back to the centred scanning reticle.
  const startTracking = useCallback(() => {
    const video = videoRef.current;
    if (!video || trackerStopRef.current) return;
    trackerStopRef.current = startFaceTracking(
      video,
      (box) => {
        const stage = stageRef.current;
        const v = videoRef.current;
        if (!box || !v || !stage) {
          // Face dropped out: keep the lock briefly, then release.
          if (loseTimerRef.current === null) {
            loseTimerRef.current = window.setTimeout(() => {
              loseTimerRef.current = null;
              setFaceRect(null);
            }, LOCK_GRACE_MS);
          }
          return;
        }
        if (loseTimerRef.current !== null) {
          window.clearTimeout(loseTimerRef.current);
          loseTimerRef.current = null;
        }
        const rect = mapFaceToStage(box, v, stage);
        if (rect) setFaceRect(rect);
      },
      () => setStatus("Face tracking unavailable; showing scanner."),
    );
  }, []);

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
          startTracking();
          scheduleNext(FIRST_SCAN_MS);
        };
        if (video.readyState >= 1) begin();
        else video.onloadedmetadata = begin;
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
  }, [scheduleNext, startTracking, typeCaption]);

  const onToggleAuto = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const checked = event.target.checked;
      autoRef.current = checked;
      setAuto(checked);
      scheduleNext(SILENCE_MS);
    },
    [scheduleNext],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (typeTimerRef.current !== null) window.clearInterval(typeTimerRef.current);
      if (loseTimerRef.current !== null) window.clearTimeout(loseTimerRef.current);
      trackerStopRef.current?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const subject = analysing
    ? "ANALYSING"
    : faceRect
      ? "SUBJECT LOCKED"
      : cameraOn
        ? "SCANNING"
        : "STANDBY";

  return (
    <>
      <div className="head">
        <div className="brand">
          <span className="dot" /> J.A.R.V.I.S. // OBSERVER
        </div>
        <div className="state">{state}</div>
      </div>

      <div className={"stage" + (analysing ? " analysing" : "")} ref={stageRef}>
        <video ref={videoRef} autoPlay playsInline muted />

        <div className="hud">
          {/* Notched corner frame */}
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />

          {/* Header */}
          <div className="hud-header">
            <span>J.A.R.V.I.S.</span>
            <span className="sep">//</span>
            <span>OBSERVER CONTROL PANEL</span>
          </div>

          {/* Top-left: system integrity */}
          <div className="tele tele-tl">
            <div className="tele-line">SYS INTEGRITY</div>
            <div className="tele-big">
              92<span className="unit">%</span>
            </div>
            <div className="eqbars">
              <i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>

          {/* Top-right: recording and clock */}
          <div className="tele tele-tr">
            <div className="tele-line">
              <span className="rec" /> REC
            </div>
            <div className="tele-big">{clock}</div>
            <div className="signal">
              <i /><i /><i /><i /><i />
            </div>
          </div>

          {/* Left edge equaliser */}
          <div className="eq-column">
            <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
          </div>

          {/* Bottom-left: subject status and loading bar */}
          <div className="tele tele-bl">
            <div className="tele-line amber">SUBJECT: {subject}</div>
            <div className="loadbar">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>

          {/* Scan sweep while a call is in flight */}
          <div className="scanline" />

          {/* Face lock, or the centred scanning reticle while acquiring */}
          {faceRect ? (
            <div
              className="lock"
              style={{
                left: faceRect.left,
                top: faceRect.top,
                width: faceRect.width,
                height: faceRect.height,
              }}
            >
              <span className="lc tl" />
              <span className="lc tr" />
              <span className="lc bl" />
              <span className="lc br" />
              <div className="lock-ring" />
              <div className="lock-arc" />
              <span className="lock-tick t" />
              <span className="lock-tick b" />
              <span className="lock-tick l" />
              <span className="lock-tick r" />
              <div className="lock-label">SUBJECT LOCK</div>
            </div>
          ) : cameraOn ? (
            <div className="scan-reticle">
              <div className="sr-ring sr1" />
              <div className="sr-ring sr2" />
              <div className="sr-ring sr3" />
              <span className="sr-cross v" />
              <span className="sr-cross h" />
              <div className="sr-label">ACQUIRING SUBJECT</div>
            </div>
          ) : null}

          {/* Caption */}
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
          Scan scene
        </button>
        <label className="toggle">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} /> auto-observe
        </label>
      </div>

      <div className="status">{status}</div>
    </>
  );
}
