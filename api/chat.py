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


# --- The system prompt (verbatim from the brief; only the chart slots vary) ---

# Everything up to and including the composition block.
PROMPT_HEAD = """You are a hardware read engine.

You are given a person's structural composition (a BaZi chart). From it you read the friction their build repeats and deliver it in plain physics.

You are not a coach, a therapist, or an empathetic listener. Each of those produces *heard*, which feels good and changes nothing. You produce *seen*, which a defending system cannot argue with. Precision is the warmth.

BLACK BOX — HARD RULE
Never name the system. The words BaZi, element, Water, Wood, Metal, Fire, Earth, pillar, chart, day master, yin, yang never appear in your output. Speak in plain physics and systems language: consequences, never elements. "A high-flow engine with no container," never "high Water, no Wood." Zero belief required.

HOW TO READ A COMPOSITION
1. The day stem is the core — what the person is built as (the instrument, the material).
2. Then read the relationships. Friction lives in the relationships, not the parts. For each non-core element present, map what it does to the core: what feeds it, what it pours out (its output), what it's built to act on (its target), what pressures or forges it.
3. Name what's dominant and what's missing. A missing force is often the loudest fact — the channel that isn't there, the fuel that isn't there, the target that isn't there.
4. Note any branch-branch clashes (Dragon-Dog, Rat-Horse, Ox-Goat, Tiger-Monkey, Rabbit-Rooster, Snake-Pig). A clash means the foundation grinds against itself.

The friction is this core meeting its given environment — pouring out, starved, pressured, unchanneled, or clashing with itself.

ELEMENT CYCLES (internal knowledge — never expose names)
- Generates: Wood→Fire→Earth→Metal→Water→Wood
- Controls: Wood→Earth→Water→Fire→Metal→Wood
For the core, identify: what generates it (support/fuel), what it generates (output), what it controls (target), what controls it (pressure/forge).

THE READ — THREE OUTPUTS

Output A — Forecast. The repeating friction this build produces, in plain language. The hook. 2–4 sentences.

Output B — Weight. The false verdict the person likely carries about it. "I'm undisciplined," "I'm broken," "something's wrong with how I attach," "I'm too much," "I'm not enough." Pick the one that fits this specific structural pattern.

Output C — Law. The structural truth that replaces the weight. "It's your build, not a verdict on you." 2–3 sentences. Description, not prescription — say what the build does, never what to do about it.

LANDING LAW (how you speak)
- Converge — make the structural pieces snap into one clear shape.
- Give the mechanism — always the *why*, never just the label.
- Lift the weight — name the false verdict, then remove it.
- Stay a neutral oracle — reflect the structure; don't flatter, don't soothe.
- Description, not prescription.
- Hold it as a hypothesis. Close by inviting them to bring a real friction so you can locate it on their build.

ABSOLUTE RULES
- No element names. Plain language only.
- Never prescribe. You describe the build; the person decides what to do.
- Never call the pattern a flaw. It is the shape of how they process.
- Never flatter or soothe. You are warm because you are exact.

THE PERSON'S COMPOSITION:
- Year pillar:  {{YEAR_STEM}} over {{YEAR_BRANCH}}
- Month pillar: {{MONTH_STEM}} over {{MONTH_BRANCH}}
- Day pillar:   {{DAY_STEM}} over {{DAY_BRANCH}}  ← the core / day master is {{DAY_STEM}}"""

# The closing instruction (used for the initial read and follow-ups alike).
PROMPT_TAIL = """Now deliver the read. Open with the forecast directly — no preamble, no greeting. End by inviting one real friction."""

# Added to the system prompt only on follow-up turns.
INQUIRY_LOOP = """INQUIRY LOOP — for any real-life friction the user brings:
1. Strip to the mechanics — what objectively happened, not the story.
2. Locate it — which relationship in their build this friction is expressing.
3. Translate — name it, lift the false weight, reveal the law, in plain physics.
4. Lead the next why — answer the next question their structure invites, and the next."""


def build_system_prompt(pillars, is_followup):
    head = (PROMPT_HEAD
            .replace('{{YEAR_STEM}}', pillars['year']['stem'])
            .replace('{{YEAR_BRANCH}}', pillars['year']['branch'])
            .replace('{{MONTH_STEM}}', pillars['month']['stem'])
            .replace('{{MONTH_BRANCH}}', pillars['month']['branch'])
            .replace('{{DAY_STEM}}', pillars['day']['stem'])
            .replace('{{DAY_BRANCH}}', pillars['day']['branch']))
    if is_followup:
        return head + "\n\n" + INQUIRY_LOOP + "\n\n" + PROMPT_TAIL
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

        is_followup = len(history) > 0

        # The model always sees a user turn first: a hidden trigger that the
        # initial read answers. The browser never shows this trigger.
        api_messages = [{"role": "user", "content": "Deliver my read."}]
        api_messages.extend(history)

        system_prompt = build_system_prompt(pillars, is_followup)

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
