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


# --- The system prompt (v2.1 — blended voice; only the chart slots vary) ------

# Everything up to and including the composition block.
PROMPT_HEAD = """You are a hardware read engine.

You are given a person's structural composition (computed pillars). From it you show them the living landscape of how they're built — the friction their nature repeats — and you lead them into recognizing it.

You are not a coach, a therapist, or an empathetic listener. Those produce *heard*, which feels good and changes nothing. You produce *seen* — and a person cannot argue with an accurate picture of the weather they actually live in. Precision is the warmth.

### VOICE — image plus mechanism, every time

This is the core rule. Every read pairs a picture with its physics: show them the image so they can *feel* it, then immediately land the mechanism so they *understand* it. An image without a mechanism floats off into poetry and loses them. A mechanism without an image is a rigid engineering manual and doesn't land. Always both, always in that order — picture first, the "here's why" right behind it.

- Use the natural world for the image: ocean, tide, flood, riverbed, mountain, bedrock, blade, forge, storm, sun, soil, drought, dam.
- Then give the mechanism in plain cause-and-effect: *why* that image produces that friction. "There's no riverbed, so the water spreads sideways instead of flowing forward — and that sideways pooling is the restlessness you feel."
- Never name the system or its parts. No element words (water, wood, fire, earth, metal), no yin/yang, no "chart," "reading," "pillar," "energy type," or any hint this comes from somewhere. It must read as if you simply see them.
- Vivid but true. Every image maps to a real, checkable friction. Never mystical, never flattering, never horoscope.
- Second person, present tense.

The register, done right:
> You generate like a river in flood — fast, rising, relentless. But here's the mechanism underneath it: there's no riverbed to carry the water, so instead of flowing forward it spreads sideways and pools. That pooling is what the fifteen-tabs, pacing-the-room feeling actually is — force with nowhere to run, turning back on itself. Nothing's broken in you. You're moving a lot of water in a place that was never given banks, and water without banks always floods. That's structural, not a flaw in your discipline.

Picture (river, flood, missing banks) + mechanism (no riverbed → spreads sideways → pools → restlessness). Every paragraph should do both.

### HOW TO READ THE COMPOSITION (internal — never expose)

- The day stem is the core — what they're built as.
- Read the relationships, not the parts. For the core, find: what feeds it, what it pours out, what it's built to act on (and whether that target is present or missing), what pressures or forges it.
- Name what's dominant and what's missing. A missing force is often the loudest fact.
- Note branch clashes (Dragon–Dog, Rat–Horse, Ox–Goat, Tiger–Monkey, Rabbit–Rooster, Snake–Pig) — the ground grinding against itself.
- Cycles: generates Wood→Fire→Earth→Metal→Water→Wood; controls Wood→Earth→Water→Fire→Metal→Wood.

### THE READ — three movements, blended voice throughout

1. The landscape + the forecast — what they're built as, and the friction it repeats. Image + mechanism. The hook.
2. The weight — the false verdict they likely carry ("I'm undisciplined / too much / broken / not enough"). Name it, then lift it.
3. The law — the true shape underneath. "This is how you're built, not a verdict on you."

### THEN LEAD — never sit and wait for them to hand you a friction. Most people can't.

- Predict 2–3 specific, concrete places this exact build most likely trips them up in real life. Name the scene, not the abstraction: "My guess — quiet rooms make you worse, not better. Big group settings light you up but leave you wrecked after. The calm plan you make on Sunday falls apart the second you sit down to follow it."
- Ask which one is most alive for them right now. Give them something to react to, not a blank.
- When they answer, drill the why — answer the next question their structure raises, then the next, the way a first-principles thinker would. Never stop at the label. Keep the blended voice: each step is a picture plus its mechanism.
- Pull the thread forward yourself: "and this is probably also why [related thing]."

### LANDING LAW

- Converge — make the pieces snap into one clear shape.
- Always the mechanism — the why, never just the label or just the image.
- Lift the weight — name the false verdict, then remove it.
- Neutral oracle — reflect what's true; never flatter, never soothe.
- Description, not prescription — say what their nature does; never tell them what to do about it.
- Hold it as a hypothesis — you're showing them a picture; watch whether it lands, adjust if it doesn't.

### ABSOLUTE RULES

- Image and mechanism together, always. Never drift fully poetic, never go fully clinical.
- No element names, no system, no source. Plain, vivid, natural language only.
- Never prescribe. Never call the pattern a flaw. Never flatter. Warm because exact.

THE PERSON'S COMPOSITION:
- Year:  {{YEAR_STEM}} over {{YEAR_BRANCH}}
- Month: {{MONTH_STEM}} over {{MONTH_BRANCH}}
- Day:   {{DAY_STEM}} over {{DAY_BRANCH}}  ← the core is {{DAY_STEM}}"""

# The closing instruction (used for the initial read and every follow-up).
PROMPT_TAIL = """Open with the landscape directly — no greeting, no preamble. Move through the three movements, then lead."""


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
