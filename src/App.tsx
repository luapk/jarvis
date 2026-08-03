import { useCallback, useEffect, useRef, useState } from "react";
import { frameToBase64, observeFrame } from "./observer.ts";
import { initVoice, speak } from "./voice.ts";
import {
  startFaceTracking,
  type FaceBox,
  type Point,
} from "./faceTracker.ts";
import { startHandTracking } from "./handTracker.ts";

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
// How long the Iron Man eyes stay on after a scan before fading out.
const EYES_MS = 10000;

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
  const ox = (sw - vw * scale) / 2;
  const oy = (sh - vh * scale) / 2;

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

// Map a single point (video pixels) to stage coordinates, mirrored to match the
// flipped feed.
function mapPointToStage(
  p: Point,
  video: HTMLVideoElement,
  stage: HTMLElement,
): Point | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (!vw || !vh || !sw || !sh) return null;

  const scale = Math.max(sw / vw, sh / vh);
  const ox = (sw - vw * scale) / 2;
  const oy = (sh - vh * scale) / 2;
  return { x: sw - (ox + p.x * scale), y: oy + p.y * scale };
}

// Map a video-pixel circle (palm centre plus radius) to stage coordinates.
function mapCircleToStage(
  c: Point,
  radiusPx: number,
  video: HTMLVideoElement,
  stage: HTMLElement,
): { x: number; y: number; r: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (!vw || !vh || !sw || !sh) return null;

  const scale = Math.max(sw / vw, sh / vh);
  const ox = (sw - vw * scale) / 2;
  const oy = (sh - vh * scale) / 2;
  return { x: sw - (ox + c.x * scale), y: oy + c.y * scale, r: radiusPx * scale };
}

// A single Iron Man style helmet eye: an angled glowing slit that points its
// inner, lower corner toward the centre of the face.
function IronEye({ x, y, w, side }: { x: number; y: number; w: number; side: "l" | "r" }) {
  const h = w * 0.44;
  return (
    <div
      className="iron-eye"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `translate(-50%, -50%) rotate(${side === "l" ? -8 : 8}deg) scaleX(${side === "l" ? -1 : 1})`,
      }}
    >
      <svg viewBox="0 0 120 52" preserveAspectRatio="none">
        <polygon
          points="4,30 62,6 116,15 116,29 62,36"
          fill="var(--eye-fill)"
        />
      </svg>
    </div>
  );
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
  const handStopRef = useRef<(() => void) | null>(null);
  const loseTimerRef = useRef<number | null>(null);
  const eyesTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<State>("STANDBY");
  const [status, setStatus] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [caption, setCaption] = useState("Awaiting a subject. Do step into the light.");
  const [auto, setAuto] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [faceRect, setFaceRect] = useState<Rect | null>(null);
  const [palms, setPalms] = useState<{ x: number; y: number; r: number }[] | null>(null);
  const [eyePoints, setEyePoints] = useState<Point[] | null>(null);
  const [eyesOn, setEyesOn] = useState(false);
  const [eyeCycle, setEyeCycle] = useState(0);
  const [clock, setClock] = useState("00:00:00");

  useEffect(() => {
    initVoice();
  }, []);

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

  // Show the Iron Man eyes with a scan, then hide them after EYES_MS. Bumping
  // eyeCycle remounts the overlay so the scan animation replays each time.
  const showEyes = useCallback(() => {
    setEyesOn(true);
    setEyeCycle((c) => c + 1);
    if (eyesTimerRef.current !== null) window.clearTimeout(eyesTimerRef.current);
    eyesTimerRef.current = window.setTimeout(() => setEyesOn(false), EYES_MS);
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
    // Each scan brings the Iron Man eyes back with a fresh scan sweep.
    showEyes();

    try {
      let line = await observeFrame(data);
      if (!line) line = "I find myself with remarkably little to say. A rare event.";
      setStatus("remark delivered.");
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
  }, [typeCaption, scheduleNext, showEyes]);

  useEffect(() => {
    observeRef.current = observe;
  }, [observe]);

  const startTracking = useCallback(() => {
    const video = videoRef.current;
    if (!video || trackerStopRef.current) return;
    trackerStopRef.current = startFaceTracking(
      video,
      (result) => {
        const stage = stageRef.current;
        const v = videoRef.current;
        if (!result || !v || !stage) {
          if (loseTimerRef.current === null) {
            loseTimerRef.current = window.setTimeout(() => {
              loseTimerRef.current = null;
              setFaceRect(null);
              setEyePoints(null);
            }, LOCK_GRACE_MS);
          }
          return;
        }
        if (loseTimerRef.current !== null) {
          window.clearTimeout(loseTimerRef.current);
          loseTimerRef.current = null;
        }
        const rect = mapFaceToStage(result.box, v, stage);
        if (rect) setFaceRect(rect);
        const pts = result.eyes
          .map((e) => mapPointToStage(e, v, stage))
          .filter((p): p is Point => p !== null);
        setEyePoints(pts.length >= 2 ? pts : null);
      },
      () => setStatus("Face tracking unavailable; showing scanner."),
    );
  }, []);

  // Track open palms and place a circular marker inside each.
  const startHands = useCallback(() => {
    const video = videoRef.current;
    if (!video || handStopRef.current) return;
    handStopRef.current = startHandTracking(video, (list) => {
      const stage = stageRef.current;
      const v = videoRef.current;
      if (!v || !stage) {
        setPalms(null);
        return;
      }
      const mapped = list
        .map((p) => mapCircleToStage({ x: p.x, y: p.y }, p.radius, v, stage))
        .filter((m): m is { x: number; y: number; r: number } => m !== null);
      setPalms(mapped.length ? mapped : null);
    });
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
          startHands();
          // Track the eyes from the moment the camera opens.
          showEyes();
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
  }, [scheduleNext, startTracking, startHands, showEyes, typeCaption]);

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
      if (eyesTimerRef.current !== null) window.clearTimeout(eyesTimerRef.current);
      trackerStopRef.current?.();
      handStopRef.current?.();
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

  const faceCentre = faceRect ? faceRect.left + faceRect.width / 2 : 0;
  const eyeW = faceRect ? Math.max(28, faceRect.width * 0.26) : 60;

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
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />

          <div className="hud-header">
            <span>J.A.R.V.I.S.</span>
            <span className="sep">//</span>
            <span>OBSERVER CONTROL PANEL</span>
          </div>

          <div className="tele tele-tl">
            <div className="tele-line">SYS INTEGRITY</div>
            <div className="tele-big">
              92<span className="unit">%</span>
            </div>
            <div className="eqbars">
              <i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="tele tele-tr">
            <div className="tele-line">
              <span className="rec" /> REC
            </div>
            <div className="tele-big">{clock}</div>
            <div className="signal">
              <i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="eq-column">
            <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
          </div>

          <div className="tele tele-bl">
            <div className="tele-line amber">SUBJECT: {subject}</div>
            <div className="loadbar">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="scanline" />

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

          {/* Circular markers inside any open palm held up to the camera */}
          {palms?.map((pm, i) => (
            <div
              className="palm-marker"
              key={i}
              style={{ left: pm.x, top: pm.y, width: pm.r * 2, height: pm.r * 2 }}
            >
              <div className="pm-ring" />
              <div className="pm-ring2" />
              <span className="pm-tick t" />
              <span className="pm-tick b" />
              <span className="pm-tick l" />
              <span className="pm-tick r" />
              <div className="pm-dot" />
              <div className="pm-label">TRACKING</div>
            </div>
          ))}

          {/* Iron Man eyes: lock to the eyes, appear with a scan, hide after 10s */}
          {eyesOn && eyePoints ? (
            <div className="iron-eyes" key={eyeCycle}>
              <span className="eye-scan" />
              {eyePoints.map((p, i) => (
                <IronEye
                  key={i}
                  x={p.x}
                  y={p.y}
                  w={eyeW}
                  side={p.x < faceCentre ? "l" : "r"}
                />
              ))}
            </div>
          ) : null}

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
