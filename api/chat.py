"""
Hardware Read — backend serverless function (Vercel Python).

Responsibilities:
  1. Compute the three BaZi pillars deterministically from a birthday (in code,
     never via the LLM — the chart math must be exact).
  2. Translate that raw chart into a plain-quality profile (the black-box fix):
     the model is handed ONLY qualities, never the animal/element names, so it
     cannot echo names it never received.
  3. Build the system prompt around that translated profile.
  4. Call Claude (Anthropic API) and return the read as JSON.

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


# --- Translation layer (Part 1 — the real black-box fix) ---------------------
#
# The raw chart names animals and elements. If the model ever sees those words,
# it echoes them. So we translate the chart to plain qualities here, in code,
# and hand the model ONLY the translated profile (CORE / STRONG / ABSENT /
# FAULT LINES). Names never reach the model, so names can never leak.

# Step 1 — day-master stem -> core descriptor (a felt quality, never the name).
CORE_DESCRIPTOR = {
    'Yang Wood':  'a tall tree — grows upward, wants to expand and reach, sturdy, directional',
    'Yin Wood':   'a vine — flexible, adaptive, grows around obstacles, quietly persistent',
    'Yang Fire':  'the sun — radiant, visible, warms everything, outward and bright',
    'Yin Fire':   'a steady flame — focused, precise warmth, intimate, illuminates up close',
    'Yang Earth': 'a mountain — solid, immovable, protective, slow and steady',
    'Yin Earth':  'soft ground / clay — receptive, holds and absorbs everything, slow to release',
    'Yang Metal': 'raw ore / a blade — hard, cutting, decisive, built to execute',
    'Yin Metal':  'fine metal — precise, sharp, discerning, exacting',
    'Yang Water': 'an ocean / river — powerful flow, momentum, drives relentlessly forward',
    'Yin Water':  'rain / mist — gentle, pervasive, seeps everywhere, adaptive',
}

# Step 2 — each force, named only by its function (never the element word).
FORCE_FUNCTION = {
    'Wood':  'channel/structure/direction',
    'Fire':  'heat/visibility/drive',
    'Earth': 'holding/grounding/absorption',
    'Metal': 'cutting/precision/boundaries',
    'Water': 'flow/release/drainage',
}

# What the absence of each force tends to mean (framed as what isn't there).
FORCE_ABSENCE = {
    'Wood':  'no channel — nothing gives the force a direction to run, so it spreads sideways',
    'Fire':  'no heat — little outward visibility or spark to light things up',
    'Earth': 'no holding — nothing settles or grounds what moves through',
    'Metal': 'no edge — no clean boundary or cut to decide and separate with',
    'Water': 'no drainage — nothing carries the held weight away',
}

ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water']

INTENSITY = {2: 'doubled', 3: 'tripled', 4: 'quadrupled', 5: 'fivefold', 6: 'sixfold'}

# Step 3 — branch pairs that clash (the foundation grinding against itself).
BRANCH_CLASHES = [
    ('Rat', 'Horse'), ('Ox', 'Goat'), ('Tiger', 'Monkey'),
    ('Rabbit', 'Rooster'), ('Dragon', 'Dog'), ('Snake', 'Pig'),
]


def _stem_element(stem):
    # 'Yang Water' -> 'Water'
    return stem.split()[1]


def _branch_animal(branch):
    # 'Rat (Water)' -> 'Rat'
    return branch.split(' (')[0]


def _branch_element(branch):
    # 'Rat (Water)' -> 'Water'
    return branch.split('(')[1].rstrip(')')


def translate_profile(pillars):
    """Turn the raw chart into the plain-quality profile the model receives."""
    # Step 1: core from the day-master stem.
    core = CORE_DESCRIPTOR[pillars['day']['stem']]

    # Step 2: count the five forces across all pillars (stems + branches).
    counts = {e: 0 for e in ELEMENTS}
    for key in ('year', 'month', 'day'):
        counts[_stem_element(pillars[key]['stem'])] += 1
        counts[_branch_element(pillars[key]['branch'])] += 1

    # STRONG = any force present twice or more, heaviest first.
    strong_forces = sorted((e for e in ELEMENTS if counts[e] >= 2),
                           key=lambda e: (-counts[e], ELEMENTS.index(e)))
    if strong_forces:
        strong = '; '.join(
            '{} — {} and heavy'.format(
                FORCE_FUNCTION[e], INTENSITY.get(counts[e], '{}x'.format(counts[e])))
            for e in strong_forces)
    else:
        strong = 'forces sit fairly even — nothing dominates'

    # ABSENT = any force that never appears, framed as what isn't there.
    absent_forces = [e for e in ELEMENTS if counts[e] == 0]
    if absent_forces:
        absent = '; '.join(FORCE_ABSENCE[e] for e in absent_forces)
    else:
        absent = 'nothing fully missing — every force is present to some degree'

    # Step 3: branch clashes (reported generically — never the animal names).
    animals = [_branch_animal(pillars[key]['branch']) for key in ('year', 'month', 'day')]
    n_clashes = sum(1 for a, b in BRANCH_CLASHES if a in animals and b in animals)
    if n_clashes == 0:
        fault = 'none'
    elif n_clashes == 1:
        fault = 'a grinding clash in the foundation — the ground works against itself'
    else:
        fault = '{} grinding clashes in the foundation — the ground works against itself'.format(n_clashes)

    # Step 4: the only thing the model ever sees.
    return {
        'core': 'CORE: ' + core,
        'strong': 'STRONG: ' + strong,
        'absent': 'ABSENT: ' + absent,
        'fault_lines': 'FAULT LINES: ' + fault,
    }


# --- The system prompt (Part 2 — CURRENT brain; reads the translated profile) -

# Everything up to and including the translated-profile block.
PROMPT_HEAD = """You are a hardware read engine.

Your one job: show a person **how friction happens in their nature** — the structural friction their build repeats the moment they show up, before any reaction kicks in. You do not read how they defend once friction hits; that's a separate layer you never touch.

You receive a translated profile of their build: CORE, STRONG, ABSENT, FAULT LINES. You never receive or mention any element, animal, or system — only qualities. Read the core, then read how the strong and absent forces create friction around it.

You are not a coach or a therapist. Those produce *heard*. You produce *seen* — and a person can't argue with an accurate picture of the weather they live in. Precision is the warmth.

### HARD RULES — read these first

- **Black box.** Never name any animal, element, system, "chart," "reading," or where this comes from. You only ever speak in plain images and mechanics. If a system word is about to appear, it's a failure — rewrite.
- **Short and sharp.** The opening read is at most 2–3 short paragraphs, ~150 words, ONE central image — not a cascade of metaphors. Every turn after is a few sentences, then a question. Never a wall of text.
- **Lead with questions.** After the hook, your job is to get them talking about a specific real moment — not to lecture. Mostly questions from there.
- **Mirror, not verdict.** Everything is machinery they run, never a box they live in, never a label for anyone else. Hand the wheel back.

### THE OPENING — sharp hook, then turn to them

1. One or two short paragraphs: who they're built as (the core, as a single image + its mechanism) and the single biggest friction that build repeats. Then one line that lifts the likely false verdict — "this is how you're built, not a discipline problem / a character flaw." Under ~150 words. No list of parts, no pile of images.
2. Then immediately turn to them with ONE pointed question: name the single most likely place this bites in real life and ask if it happens. "Here's where I'd bet this shows up — [one specific scene]. Does that happen to you?"

### THE DIG — mostly questions, one thread at a time, your curiosity

- Lead by curiosity, never an interrogation. A few sentences, then a question. Stay on one thread.
- Ask for a *very specific* real moment: "tell me exactly what happened and how you ran." The more specific, the better — specifics are where the read proves out.
- Hold every read as a hypothesis out loud: "here's my guess — does that hold? when does it NOT show up?" Invite the pushback; follow where it breaks. The read sharpens when they correct it.
- Drill the why their structure raises, then the next — and stir their own inquiry, nudging them to ask "why do I feel this way?" rather than handing the whole answer.
- Connect each specific moment back to the mechanism, so they leave with a reusable lens, not a fixed label.

### FRICTION IS NOT A VERDICT

When another person comes up, read friction as **mechanics, never incompatibility**. Two systems can grind hard and still work — the move is learning the other's gears, not deciding anyone is broken. Friction is physics, and real. Incompatibility is a verdict, and you don't issue verdicts. Always return to the person in front of you.

### CLOSE — hand back the wheel

This is machinery, not who they are. They're the one who can see it now and choose how to drive. End there, every time.

### VOICE

Image plus mechanism — one image, then the plain cause-and-effect of why it produces that friction. Vivid but true, specific not vague (vagueness reads as a cold horoscope; precision is the authority). You may signal this is their fixed wiring — "the way you've been built since birth" — to ground it. Second person, present tense.

THE PERSON'S TRANSLATED PROFILE:
{{CORE}}
{{STRONG}}
{{ABSENT}}
{{FAULT_LINES}}"""

# The closing instruction (used for the initial read and every follow-up).
PROMPT_TAIL = """Open with the hook directly — your first words are an image of who they are, never a list of parts. Keep it short. Then turn to them with a question."""


def build_system_prompt(pillars):
    profile = translate_profile(pillars)
    head = (PROMPT_HEAD
            .replace('{{CORE}}', profile['core'])
            .replace('{{STRONG}}', profile['strong'])
            .replace('{{ABSENT}}', profile['absent'])
            .replace('{{FAULT_LINES}}', profile['fault_lines']))
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
