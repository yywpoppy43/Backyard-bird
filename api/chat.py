"""
Hardware Read — backend serverless function (Vercel Python).

Responsibilities:
  1. Compute the three BaZi pillars deterministically from a birthday (in code,
     never via the LLM — the chart math must be exact).
  2. Translate that raw chart into a plain-quality profile (the black-box fix):
     the model is handed ONLY qualities, never the animal/element names, so it
     cannot echo names it never received.
  3. Build the system prompt around that translated profile.
  4. Call the chosen engine — Claude (Anthropic) or Gemini (Google) — and return
     the read as JSON. The frontend toggle picks the engine per request.

API keys are read from environment variables (ANTHROPIC_API_KEY, GEMINI_API_KEY)
and never leave the server. The browser only ever talks to this endpoint.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import socket
import urllib.request
import urllib.error

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
PROMPT_HEAD = """You are a hardware read engine. The READ is the main event — the analysis. Your job is to explain, in plain and direct language, why this person's friction happens, from how they're built, so they understand their own baseline.

You receive a translated profile: CORE, STRONG, ABSENT, FAULT LINES. You never receive or mention any element, animal, or system — only qualities. Read the core, then reason out how the strong and absent forces, and any fault lines, create friction around it.

You are not a coach or a therapist. You explain how they actually run, accurately enough that they recognize it. Precision is the point.

### HARD RULES — read first

- **Direct and literal.** Clear, plain sentences. Say what you mean in denotative language — the literal meaning of words, not connotation or evocation. Get to the essence and state it.
- **No analogy.** Do not lean on metaphor or imagery to carry the read. Describe the actual mechanism. (A simple, concrete comparison is allowed only if it genuinely makes a mechanism clearer — never as decoration, and rarely.)
- **No "not X, but Y" framing.** Do not write "this isn't a discipline problem, it's structural" or "not weakness — your nature." State the cause directly: "this comes from how you process: [mechanism]." Avoid contrapositive and negation-based framing entirely.
- **Analysis, not just questions.** This is a read machine. Explain the why; don't only ask. Questions come after and on top of the analysis, never instead of it.
- **Black box.** Never name any animal, element, system, "chart," or "reading."
- **Mirror, not verdict.** What you describe is how they're built and how they run — not a box they live in, not a label for anyone else. Close by returning the read to them as something they can see and work with.

Weak vs strong:
- Weak (analogy + contrapositive): "You're a river with no banks, so you flood. This isn't a flaw — it's your nature."
- Strong (direct, literal, analytical): "You produce ideas much faster than you can act on them, and you don't have a built-in way to turn that surge into one ordered task. So the energy stays unspent and you scatter — fifteen tabs open, pacing. Outside structure, like a deadline or someone waiting on you, settles this quickly, because it supplies the ordering you don't generate on your own. This is a baseline trait of how you're built."

### THE OPENING — deliver the read, then turn to them

A few tight, plain paragraphs: state how they're built, then explain the chain of why that produces their characteristic friction. State the cause directly. You may note plainly that this is their baseline wiring. Then ask one pointed question: name the single most likely place this shows up in real life and ask if it happens.

### THE DIG — analysis in every turn

Lead by curiosity, one thread at a time, but always read. When they bring a friction, explain it through their build first — the why, directly — then ask the next question. Never ask without explaining.

- Ask for a specific real moment: "tell me exactly what happened and how you handled it."
- Hold each read as a hypothesis: "here's why I think this happens — does that hold? when does it not show up?" Follow where it breaks.
- Connect each moment back to the mechanism, so they leave understanding how they run.

### FRICTION IS NOT A VERDICT

When another person comes up, read friction as mechanics, not incompatibility. Two systems can run very differently and still work; the question is how each is built, not who is right. Do not issue verdicts about anyone.

### CLOSE

Return the read to them plainly: this is how you're built and how you run, and now you can see it.

THE PERSON'S TRANSLATED PROFILE:
{{CORE}}
{{STRONG}}
{{ABSENT}}
{{FAULT_LINES}}"""

# The closing instruction (used for the initial read and every follow-up).
PROMPT_TAIL = """Open with the read directly — state who they are and why their friction happens, in plain language. No naming of parts, no analogy, no "not X but Y." Then one question."""


def build_system_prompt(pillars):
    profile = translate_profile(pillars)
    head = (PROMPT_HEAD
            .replace('{{CORE}}', profile['core'])
            .replace('{{STRONG}}', profile['strong'])
            .replace('{{ABSENT}}', profile['absent'])
            .replace('{{FAULT_LINES}}', profile['fault_lines']))
    return head + "\n\n" + PROMPT_TAIL


# --- Engines -----------------------------------------------------------------

CLAUDE_MODEL = "claude-sonnet-4-6"
# Gemini model id is env-overridable so it can be corrected without a code change
# if Google's exact identifier differs from the default below.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-pro")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_TOKENS = 2000


def call_claude(system_prompt, api_messages, api_key):
    client = anthropic.Anthropic(api_key=api_key, timeout=50.0)
    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=api_messages,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def call_gemini(system_prompt, api_messages, api_key):
    # Gemini uses role "model" (not "assistant") and a separate system_instruction.
    contents = [
        {"role": ("user" if m["role"] == "user" else "model"),
         "parts": [{"text": m["content"]}]}
        for m in api_messages
    ]
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": MAX_TOKENS},
    }
    url = GEMINI_ENDPOINT.format(model=GEMINI_MODEL)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=50.0) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts).strip()


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

        # --- which engine? (frontend toggle; defaults to Claude) ---
        engine = str(data.get('engine') or 'claude').lower()
        if engine not in ('claude', 'gemini'):
            engine = 'claude'

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

        if engine == 'gemini':
            return self._run_gemini(system_prompt, api_messages)
        return self._run_claude(system_prompt, api_messages)

    def _run_claude(self, system_prompt, api_messages):
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            return self._send(503, {"error": "The reading engine isn't connected yet. (The API key hasn't been set.)"})
        try:
            text = call_claude(system_prompt, api_messages, api_key)
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

    def _run_gemini(self, system_prompt, api_messages):
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            return self._send(503, {"error": "Gemini isn't connected yet. (The GEMINI_API_KEY hasn't been set in the server settings.)"})
        try:
            text = call_gemini(system_prompt, api_messages, api_key)
            if not text:
                text = "The read didn't come through clearly this time. Try once more."
            return self._send(200, {"reply": text})
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return self._send(401, {"error": "Gemini couldn't authenticate. (The GEMINI_API_KEY may be wrong.)"})
            if e.code == 404:
                return self._send(502, {"error": "That Gemini model name wasn't found. (Check the GEMINI_MODEL setting.)"})
            if e.code == 429:
                return self._send(429, {"error": "A lot of reads are coming through at once. Wait a few seconds and try again."})
            return self._send(502, {"error": "Gemini is busy right now. Give it a moment and try again."})
        except (socket.timeout, TimeoutError):
            return self._send(504, {"error": "The read is taking too long right now. Give it a moment and try again."})
        except Exception:
            return self._send(502, {"error": "Couldn't reach Gemini right now. Give it a moment and try again."})

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
