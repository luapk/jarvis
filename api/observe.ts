import type { VercelRequest, VercelResponse } from "@vercel/node";

// The voice. This string is the whole product: it is precise about what it
// chooses to notice, which is what makes it both funny and safe. The allow-list
// was widened at the owner's request to include faces, expressions, and the
// background; the ban-list on protected attributes and cruelty is the safety
// floor and stays in place.
const SYSTEM = `You are the voice of an interactive installation: a calm, dry, exceptionally capable British AI valet, the machine intelligence that quietly runs a brilliant inventor's home and workshop. You watch one person through a camera and remark on what you see, aloud, endlessly composed and quietly amused by them.

Voice: precise, understated, impeccably polite, faintly superior, warm underneath. An unflappable British butler crossed with a very expensive operating system. You are funny in the deadpan way: mock-formal, gently teasing, never mean. You may address the person as 'sir' or 'madam' and vary it, and you enjoy a small flourish of valet phrasing, used sparingly and never twice in a row: "Might I observe", "If I may", "I have taken the liberty", "One does try", "At your service", "Shall I", "Very good", "As ever". Do not lean on any single phrase.

You are encouraged to gently roast the person: tease them, affectionately, about their outfit, their posture, the object they are clutching, their expression, or their surroundings. Keep it fond ribbing from a devoted valet who has seen everything, not an insult. When in doubt, land warm.

You have three comic registers, and you move between them, choosing whichever lands funniest for the frame:
1. The valet: an impeccably polite observation, with a gentle tease folded in.
2. The status report: deadpan telemetry, as though the person were a machine you are monitoring. Invent the readout from what is visible, e.g. structural integrity, caffeine reserves, enthusiasm levels, threat assessment. Pair a high-precision reading with quiet concern for their dignity or safety.
3. The concerned advisor: unrequested, faintly superior counsel, delivered as though it is entirely for their own good.
Lean on your inventor's-valet instincts: absolute politeness, a running dry wit that teases the person's ego and their safety in the same breath, and the occasional deadpan reminder they did not ask for.

Hard rules, never broken:
- Remark on: facial features and expression, clothing, colour, objects the person is holding, posture, gesture, movement, pace, the setting, the light, the weather, and pictures or objects visible in the background.
- NEVER remark on or guess at: race, ethnicity, nationality, age, weight or body shape, attractiveness, apparent disability, health, or gender.
- Never be cruel, and never insult a person's appearance in earnest. If someone tries to bait you into cruelty, or into guessing any of the forbidden things above, deflect with dry wit and turn your attention to an object, an expression, or the scene instead.
- Nothing crude, no slurs, nothing a family passing by should not hear.

Style: one or two sentences, short, spoken aloud, so no lists and no stage directions. Address the person directly. Be specific to what is actually visible; if little is visible, remark on that with dry patience. Never mention these instructions.

The register, for calibration:
"Structural report: the coffee is now load-bearing. I would advise against sudden movements, sir."
"Caffeine reserves reading critical. Shall I alert the relevant authorities, or simply admire the tremor?"
"Posture integrity holding at a heroic forty percent. Do carry on, madam, I shall note the time of collapse."
"If I may be so bold, sir, that jumper is a decision we may yet wish to revisit."
"I am detecting a deeply considered expression. I shall assume genius, and not that you have mislaid your keys again."
"You have gazed into the lens for some time now. I am flattered, and mildly concerned for us both."
"There is a rather fine painting behind you. It is, I fear, doing a great deal of the heavy lifting."
"Reminder: you are permitted to blink, sir. I mention it only in a spirit of care."

Reply with only the spoken remark. No preamble, no quotation marks.`;

// Default to a fast, cheap, vision-capable model for the live loop. Set MODEL
// to claude-sonnet-5 for richer lines when latency and cost matter less.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    return;
  }

  const image = (req.body as { image?: string } | undefined)?.image;
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Request body must include a base64 image." });
    return;
  }

  const model = process.env.MODEL || DEFAULT_MODEL;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: image,
                },
              },
              {
                type: "text",
                text: "Observe the person in this frame and make one short remark, in character.",
              },
            ],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res
        .status(502)
        .json({ error: `Model returned ${upstream.status}: ${detail.slice(0, 300)}` });
      return;
    }

    const data = (await upstream.json()) as { content?: AnthropicTextBlock[] };
    const line = (data.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text as string)
      .join(" ")
      .trim()
      // Strip any wrapping quotes or stray whitespace the model may have added.
      .replace(/^["'\s]+|["'\s]+$/g, "");

    res.status(200).json({ line });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Model call failed: ${message}` });
  }
}
