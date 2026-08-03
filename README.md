# JARVIS Observer

A web installation that watches one person through a webcam, remarks on what it
sees in a dry British-AI register, and speaks the remark aloud. It runs as a
continuous loop suitable for an unattended screen. The model call sits behind a
serverless function, so the API key is never exposed in the browser.

This is a pitch and installation demo for an advertising concept. The voice is
the product. The wit and the safety guardrail are the same craft: it is precise
about what it chooses to notice, which is what makes it both funny and safe.

## How it works

1. The browser opens the webcam and shows a mirrored live feed.
2. Every 8 seconds, and on the Observe button, it captures the current frame to
   a canvas, downscales to a maximum of 768px wide, and encodes it as JPEG at
   quality 0.7.
3. The base64 frame is POSTed to `/api/observe`.
4. The serverless function calls the Anthropic Messages API with the system
   prompt plus the image, and returns a single short line.
5. The browser types the line out as a HUD caption and speaks it, using the
   ElevenLabs installation voice via `/api/speak` when configured, otherwise the
   browser Web Speech API with a British English voice.
6. Requests never overlap: a scan runs only after the previous observation and
   its spoken line finish, then the loop holds ten seconds of silence before the
   next scan.

## Privacy

No frame is ever written to disk, logged, or sent anywhere except the single
model call to Anthropic. There is no database, no analytics, and no image
storage of any kind. For a live public installation, production would need a
moderated feed with a human kill switch and visible signage. That is out of
scope for this build but is stated here for the record.

## Guardrails

The allow-list and ban-list live in the system prompt in `api/observe.ts`. The
voice remarks on facial features and expression, clothing, colour, objects held,
posture, gesture, movement, pace, the setting, light, weather, and pictures or
objects visible in the background. It never remarks on or guesses at race,
ethnicity, nationality, age, weight or body shape, attractiveness, apparent
disability, health, or gender. If someone tries to bait it into cruelty or into
guessing those things, it deflects with dry wit and turns to an object, an
expression, or the scene instead.

The ban-list on protected attributes and the "never cruel, no slurs" floor are
the safety floor and are kept in place. Commenting on faces, expressions, and
the background was enabled deliberately at the owner's request.

## Project structure

```
api/observe.ts     serverless function: holds the Anthropic key, calls the model
api/speak.ts       serverless function: holds the ElevenLabs key, returns audio
src/App.tsx        the installation UI and capture loop
src/observer.ts    frame capture, downscale, encode, fetch helper
src/voice.ts       ElevenLabs voice with browser Web Speech fallback, speak()
src/hud.css        HUD styling
index.html         Vite entry point
jarvis-street-demo.html   the original single-file reference (look and behaviour)
```

## Local development

```
npm install
```

Set your key in a local `.env` file (see `.env.example`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then run both the Vite dev server and the serverless function together with the
Vercel CLI (it serves `/api` locally and proxies the Vite dev server):

```
npm i -g vercel
vercel dev
```

`npm run dev` alone runs the front end but not the `/api/observe` function, so
observations will fail until you use `vercel dev` or deploy.

## Environment variables

- `ANTHROPIC_API_KEY` (required): read server-side only, never sent to the
  browser or included in the client bundle.
- `MODEL` (optional): defaults to `claude-haiku-4-5-20251001`, a fast, cheap,
  vision-capable model for the live loop. Set to `claude-sonnet-5` for richer
  lines when latency and cost are less critical.
- `ELEVENLABS_API_KEY` (optional): enables the ElevenLabs installation voice,
  read server-side only. If unset, the app uses the browser voice, so the demo
  needs only the Anthropic key.
- `ELEVENLABS_VOICE_ID` (optional): the ElevenLabs voice. Defaults to the
  installation voice baked into `api/speak.ts`.
- `ELEVENLABS_MODEL_ID` (optional): defaults to `eleven_multilingual_v2`
  (quality). Set to `eleven_turbo_v2_5` or `eleven_flash_v2_5` for lower latency
  before audio starts.
- `ELEVENLABS_SPEED` (optional): speaking pace, `0.7` (slow) to `1.2` (fast).
  Defaults to `1.1`.

## Entry gate

The installation opens on a dark splash screen that asks for a passphrase
(`jarvis`) before the observer loads. This is a soft gate for the installation
screen, not security: the check runs in the browser and can be bypassed, so do
not rely on it to protect anything sensitive.

## Deploy

1. Push this repository to GitHub.
2. Import it in Vercel. The framework preset is Vite.
3. Set `ANTHROPIC_API_KEY` in the Vercel project settings. Optionally set
   `MODEL`.
4. Deploy. Confirm the live URL loads, the camera prompts, and lines return and
   are spoken.

Alternatively, use the `vercel` CLI end to end.

## Photo fallback

Where the sandboxed camera is blocked, use the "Use a photo instead" control to
load an image file. The loop is identical whether the frame comes from the
camera or an upload.

## Out of scope for this build

- Marvel and talent clearance for the JARVIS name and any specific voice. This
  build uses an original British-AI register and voice, not an impersonation.
- A live moderation feed and kill switch for a public installation.
- Analytics, storage, or any retention of captured frames.
