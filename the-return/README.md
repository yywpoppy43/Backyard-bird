# THE RETURN — The Agnostic Node Canvas

A functional, clickable prototype of the first feature. A node-based canvas
(Miro / Obsidian feel) where a person dumps their **Current Friction**, the
system runs a **Silent Read** to find their **Default Doorway** (HEAD / HEART /
GUT), and emits a single **Wedge** prompt that forces them to build a node in a
*different* processing centre.

It is a mechanism, not a chatbot. The system's only output is (1) a mechanical
read-out and (2) a prompt asking the user to create a new, connected node. It
never interprets, reassures, or advises.

## Run it

Open `index.html` in any modern browser — that's it. No build, no server, no
network, no dependencies. The file is fully self-contained.

## The flow

1. **The Raw Dump.** Type the friction into the seeded *Current Friction* node.
2. **The Silent Read.** Click *Run the Silent Read* (or ⌘/Ctrl+Enter). A
   transparent keyword + sentiment/intensity engine scores the text across three
   centres and picks the Default Doorway. The read-out and a score bar appear on
   the node — the forecast engine is exposed, not hidden.
3. **The Wedge.** A connected Wedge node spawns with the cross-centre prompt.
   Click its button to spawn the node it demands, then name it. That second node
   is the wedge — it pulls the operator out of the over-weighted reading.

Also: **double-click** empty canvas for a free node · **drag** a header to move ·
**⛓** on a node to link it to another · **Reset** to run a fresh friction.

## The read → wedge map

| Default Doorway (detected) | Reads as | Wedge forces → | Prompt asks for |
|---|---|---|---|
| **HEAD** — analytical, anxious, predictive, variables/risk | mapping | **GUT** | a *physical action* node |
| **GUT** — barriers, action, anger, inefficiency, push-through | impact | **HEAD** | a *structural risk* node |
| **HEART** — relationships, feelings, status, conflict, atmosphere | resonance | **GUT** | a *physical action* node |

The two prompts pinned by the spec are reproduced verbatim:

- HEAD → *"You have mapped the logic. Now, where does this exact friction hit the
  ground? Add a physical action node."*
- GUT → *"You have mapped the impact. Now, what is the predictive simulation if
  this fails? Add a structural risk node."*

### Design decision: where HEART wedges to

The spec left HEART open ("Head/Gut"). It routes to **GUT** (the body — your
un-fakeable proving ground). Rationale: the relational/emotional narrative is the
most *fakeable* layer, so the strongest wedge drops it into the body where the
story can't be performed. The wedge always moves *toward provable reality*
(structure or body) and never *into* the emotional atmosphere — so HEART is a
source but never a destination. This is one line in the `WEDGES` map; flip
`HEART.to` to `'HEAD'` (and its prompt/responseType) to retune.

## How the Silent Read works

`classifier.js` — pure, deterministic, no LLM. For each centre it sums weighted
hits from a single-word **lexicon** and a multi-word **phrase** list, then adds
capped **sentiment/intensity signals**:

- HEAD ← `?` density + conditional/predictive modals (*if, might, what if…*)
- GUT ← `!` density + ALL-CAPS intensity + anger/barrier terms
- HEART ← people/relational reference density (*you, they, colleague, partner…*)

Highest score wins; an undifferentiated or empty dump falls back to HEAD. The
return value also carries per-centre scores, confidence, and matched terms — the
canvas renders these so the mechanism stays inspectable.

## Files

- `index.html` — the prototype (UI + an inlined copy of the read engine).
- `classifier.js` — the same Silent Read as a standalone module (single source
  of truth, mirrored into `index.html`).
- `test/classifier.test.js` — headless checks. Run: `node test/classifier.test.js`.

## Constraints honored

- No therapist voice, no chatbot, no advice. System output = read-out + a
  node-creation prompt, nothing else.
- The body is the landing place: two of three doorways wedge into a physical
  action node.
