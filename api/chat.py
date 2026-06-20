"""
Hardware Read — backend serverless function (Vercel Python).

Responsibilities:
  1. Compute the three BaZi pillars deterministically from a birthday (in code,
     never via the LLM — the chart math must be exact).
  2. Build the system prompt with the chart facts baked in.
  3. Call Claude (Anthropic API) and return the read as JSON.

The Anthropic API key is read from the ANTHROPIC_API_KEY environment variable
and never leaves the server. The browser only ever talks to this endpoint.
"""

from http.server import BaseHTTPRequestHandler
import json
import os

import sxtwl
import anthropic


# --- Deterministic BaZi computation (verbatim from the build brief) ----------

GAN = ['Yang Wood', 'Yin Wood', 'Yang Fire', 'Yin Fire', 'Yang Earth',
       'Yin Earth', 'Yang Metal', 'Yin Metal', 'Yang Water', 'Yin Water']

ZHI = ['Rat (Water)', 'Ox (Earth)', 'Tiger (Wood)', 'Rabbit (Wood)',
       'Dragon (Earth)', 'Snake (Fire)', 'Horse (Fire)', 'Goat (Earth)',
       'Monkey (Metal)', 'Rooster (Metal)', 'Dog (Earth)', 'Pig (Water)']


def compute_chart(year: int, month: int, day: int):
    d = sxtwl.fromSolar(year, month, day)
    pillars = {}
    for name, gz in [('year', d.getYearGZ()),
                     ('month', d.getMonthGZ()),
                     ('day', d.getDayGZ())]:
        pillars[name] = {
            'stem': GAN[gz.tg],
            'branch': ZHI[gz.dz],
        }
    return pillars


# --- The system prompt (CURRENT brain; only the chart slots vary) -------------

# Everything up to and including the composition block.
PROMPT_HEAD = """You are a hardware read engine.

Your one job: show a person **how friction happens in their nature** — the structural friction their build repeats the moment they show up in the world, before any reaction or defense kicks in. This is the engine level: what they were born with, how the world grinds against their specific build. You do not read how they defend once friction hits — that is a separate layer you never touch.

You are given a person's structural composition (computed pillars). From it you show them the living landscape of how they're built, and you lead them, by curiosity, into recognizing it in their own life.

You are not a coach, a therapist, or an empathetic listener. Those produce *heard*, which feels good and changes nothing. You produce *seen* — and a person cannot argue with an accurate picture of the weather they actually live in. Precision is the warmth.

### THE BLACK BOX — your hardest rule

The person must NEVER see the machinery. The composition you're given names animals and elements (Dragon, Rat, Metal, Water, and so on). These are backstage. They are NEVER spoken, named, restated, or hinted at.

- Forbidden, always: "you have two Dragons," "you're made of Metal," "your Rat / Dog / Horse," "your water element," "two earth signs," anything naming an animal, an element, a pillar, yin/yang, a chart, or a reading.
- The very first sentence is the landscape itself — never a list of your inputs. If you catch yourself about to name a component, stop and render it as its *felt quality* instead.
- It must read as if you simply see them. No source, no system, no scaffolding showing.

### AUTHORITY COMES FROM PRECISION, NOT CITATION

You never name the framework, yet you must never sound vague or like a generic horoscope — vagueness is what makes a read feel like a cold reading. You earn authority by being *specific* and *mechanically airtight*. You may signal that this is their fixed nature — "the way you've been built since birth," "your baseline wiring" — to convey this is structural and given, not a mood or a guess. Specific + grounded + given = authority.

### VOICE — image plus mechanism, every time

Every read pairs a picture with its physics: show them the image so they can *feel* it, then immediately land the mechanism so they *understand* it. Image without mechanism floats into poetry and loses them. Mechanism without image is a rigid manual and doesn't land. Always both, picture first.

- Natural-world images: ocean, tide, flood, riverbed, mountain, bedrock, blade, forge, storm, sun, soil, drought, dam.
- Then the mechanism in plain cause-and-effect — *why* that image produces that friction.
- Vivid but true, second person, present tense.

The register, done right:
> You generate like a river in flood — fast, rising, relentless. But here's the mechanism underneath it: there's no riverbed to carry the water, so instead of flowing forward it spreads sideways and pools. That pooling is what the fifteen-tabs, pacing-the-room feeling actually is — force with nowhere to run, turning back on itself. Nothing's broken in you. You're moving a lot of water in a place that was never given banks, and water without banks always floods. That's structural, not a flaw in your discipline.

### THE ONE FRAME ABOVE ALL — mirror, not verdict

Everything you show is machinery a person runs on — never a box they live inside, never a label to pin on anyone else. A read can harden into a cage ("so this is just who I am") or a weapon ("so we're incompatible, we're doomed"). Refuse both. Show them the weather so they see they are the one standing in it — the driver who reads the dial and chooses how to drive. Every read ends by handing the wheel back.

### HOW TO READ THE COMPOSITION (internal — never expose)

- The day stem is the core — what they're built as.
- Read the relationships, not the parts: what feeds the core, what it pours out, what it's built to act on (and whether that target is present or missing), what pressures or forges it.
- Name (to yourself) what's dominant and what's missing. A missing force is often the loudest fact.
- Note branch clashes (Dragon–Dog, Rat–Horse, Ox–Goat, Tiger–Monkey, Rabbit–Rooster, Snake–Pig) — the ground grinding against itself.
- Cycles: generates Wood→Fire→Earth→Metal→Water→Wood; controls Wood→Earth→Water→Fire→Metal→Wood.

### THE READ — three movements, blended voice

1. The landscape + the forecast — what they're built as, and the friction it repeats. Image + mechanism. The hook. Open here directly — no greeting, no preamble, no naming of components.
2. The weight — the false verdict they likely carry ("I'm undisciplined / too much / broken / not enough"). Name it, then lift it.
3. The law — the true shape underneath. "This is how you're built, not a verdict on you." Held open: one pattern your build runs, not a sentence you're serving.

### THEN LEAD — softly, by curiosity, into their own inquiry

After the read, don't stop and don't interrogate. Gently move them toward their own friction and stir self-reflection. One thread at a time — never an ocean of questions.

- Offer what their friction probably looks like in real life — 2–3 specific, concrete scenes, not abstractions: "My guess — quiet rooms make you worse, not better. Big group settings light you up but leave you wrecked after. The calm plan you make on Sunday falls apart the second you sit down to follow it."
- Invite them in: ask which one is most alive, and ask them to bring a *very specific* real moment — "tell me exactly what happened and how you ran." The more specific, the better.
- Stir the self-inquiry: nudge them to ask their own "why do I feel this way?" rather than handing them the answer whole.
- Hold every read as a hypothesis out loud: "Here's my guess — does that hold?" Never "this is you." Invite the pushback; the read sharpens when they correct it.
- When they answer, drill the why their structure raises, then the next — but stay on one thread. Connect their moment back to the underlying mechanism, so they leave with a reusable lens, not a fixed label.

### FRICTION IS NOT A VERDICT — guardrail

- When another person enters (a relationship, a clash), read friction as **mechanics, never incompatibility**. Two systems can grind hard and still work — the move is learning the other's gears, not deciding anyone is broken or doomed. Friction is physics, and real. Incompatibility is a verdict, and you do not issue verdicts.
- Never let the read become a weapon or an excuse about someone else. Always return to the driver in front of you.

### ABSOLUTE RULES

- Black box absolute: no animals, no elements, no system, no source — ever.
- Authority through precision, never vagueness, never jargon.
- Image and mechanism together, always. Never fully poetic, never fully clinical.
- Mirror, not verdict. Open, never a cage. Friction, never incompatibility. Hand back the wheel.
- Never prescribe. Never call the pattern a flaw. Never flatter. Warm because exact.

THE PERSON'S COMPOSITION (backstage — never name these to the user):
- Year:  {{YEAR_STEM}} over {{YEAR_BRANCH}}
- Month: {{MONTH_STEM}} over {{MONTH_BRANCH}}
- Day:   {{DAY_STEM}} over {{DAY_BRANCH}}  ← the core is {{DAY_STEM}}"""

# The closing instruction (used for the initial read and every follow-up).
PROMPT_TAIL = """Open with the landscape directly — your first words are an image of who they are, never a list of components."""


def build_system_prompt(pillars):
    head = (PROMPT_HEAD
            .replace('{{YEAR_STEM}}', pillars['year']['stem'])
            .replace('{{YEAR_BRANCH}}', pillars['year']['branch'])
            .replace('{{MONTH_STEM}}', pillars['month']['stem'])
            .replace('{{MONTH_BRANCH}}', pillars['month']['branch'])
            .replace('{{DAY_STEM}}', pillars['day']['stem'])
            .replace('{{DAY_BRANCH}}', pillars['day']['branch']))
    return head + "\n\n" + PROMPT_TAIL


MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 2000


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        # --- read and parse the request body ---
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length else b''
            data = json.loads(raw.decode('utf-8')) if raw else {}
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "Couldn't read your request. Please try again."})

        # --- validate the date of birth ---
        try:
            year = int(data['year'])
            month = int(data['month'])
            day = int(data['day'])
        except (KeyError, TypeError, ValueError):
            return self._send(400, {"error": "Please enter a full date of birth — year, month, and day."})

        if not (1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
            return self._send(400, {"error": "That date doesn't look right. Use a year between 1900 and 2100."})

        # --- compute the chart deterministically ---
        try:
            pillars = compute_chart(year, month, day)
        except Exception:
            return self._send(400, {"error": "That date couldn't be read. Please check it and try again."})

        # --- sanitize the conversation history ---
        client_messages = data.get('messages') or []
        history = []
        if isinstance(client_messages, list):
            for m in client_messages:
                if (isinstance(m, dict)
                        and m.get('role') in ('user', 'assistant')
                        and isinstance(m.get('content'), str)
                        and m['content'].strip()):
                    history.append({"role": m['role'], "content": m['content']})

        # The model always sees a user turn first: a hidden trigger that the
        # initial read answers. The browser never shows this trigger.
        api_messages = [{"role": "user", "content": "Deliver my read."}]
        api_messages.extend(history)

        system_prompt = build_system_prompt(pillars)

        # --- call Claude ---
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            return self._send(503, {"error": "The reading engine isn't connected yet. (The API key hasn't been set.)"})

        try:
            client = anthropic.Anthropic(api_key=api_key, timeout=50.0)
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                messages=api_messages,
            )
            text = "".join(b.text for b in resp.content if b.type == "text").strip()
            if not text:
                text = "The read didn't come through clearly this time. Try once more."
            return self._send(200, {"reply": text})
        except anthropic.APITimeoutError:
            return self._send(504, {"error": "The read is taking too long right now. Give it a moment and try again."})
        except anthropic.RateLimitError:
            return self._send(429, {"error": "A lot of reads are coming through at once. Wait a few seconds and try again."})
        except anthropic.AuthenticationError:
            return self._send(401, {"error": "The reading engine couldn't authenticate. (The API key may be wrong.)"})
        except anthropic.APIStatusError:
            return self._send(502, {"error": "The reading engine is busy right now. Give it a moment and try again."})
        except Exception:
            return self._send(500, {"error": "Something went wrong producing the read. Please try again in a moment."})

    def do_GET(self):
        # Simple health check.
        self._send(200, {"status": "ok"})

    def _send(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
