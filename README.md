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
5. The browser types the line out as a HUD caption and speaks it with the Web
   Speech API using a British English voice.
6. Requests never overlap. If one is in flight, the next tick is skipped.

## Privacy

No frame is ever written to disk, logged, or sent anywhere except the single
model call to Anthropic. There is no database, no analytics, and no image
storage of any kind. For a live public installation, production would need a
moderated feed with a human kill switch and visible signage. That is out of
scope for this build but is stated here for the record.

## Guardrails

The allow-list and ban-list live in the system prompt in `api/observe.ts` and
must not be weakened. The voice remarks only on clothing, colour, objects,
posture, gesture, movement, pace, the setting, light, and weather. It never
remarks on or guesses at race, ethnicity, nationality, age, weight or body
shape, attractiveness, apparent disability, health, gender, or a person's face
or body as a body. If someone tries to bait it into commenting on their body or
identity, it deflects with dry wit and turns to an object or the scene instead.

## Project structure

```
api/observe.ts     serverless function: holds the key, calls the model
src/App.tsx        the installation UI and capture loop
src/observer.ts    frame capture, downscale, encode, fetch helper
src/voice.ts       Web Speech API voice selection and speak()
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
  build uses an original British-AI register and the browser voice, not an
  impersonation.
- A live moderation feed and kill switch for a public installation.
- Analytics, storage, or any retention of captured frames.
