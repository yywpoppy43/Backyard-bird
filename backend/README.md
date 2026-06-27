# Active Friction Voice Companion — Backend

The **Behavioral Physics Engine** behind an active-state audio companion. It is a
headless, event-driven backend that drives the PRD's *Friction State Machine*,
selects verbal *Cues* from a strict relational matrix, and fires them at precise
friction "tipping points" detected either by **time** (V1) or **biometrics** (V2).

> This package is backend only — **no UI**. A future UI/mobile client is purely a
> consumer of the typed event stream plus the swappable TTS/Telemetry adapters.

---

## The model (PRD §2–§5)

### Friction State Machine

Four states, in stage order. They are also the exact value set of the Cue
object's `PrimaryState`.

```
                 ADVANCE                 TIPPING_POINT_DETECTED
   ┌──────────┐  (anchor   ┌───────────┐  (time or biometric   ┌───────────┐
   │ BASELINE │  settled)  │ INTENTION │   threshold reached)   │ ENCOUNTER │
   │ Stage I  │ ─────────▶ │ Stage II  │ ─────────────────────▶│ Stage III │
   │ Anchor   │            │ Vector    │      ▲                 │ Tipping   │
   └──────────┘            └───────────┘      │ NEXT_ROUND      └─────┬─────┘
        ▲                        ▲            │ (after cooldown)      │  │
        │                        └────────────┼───────────────┐      │  │ DESTABILIZED
   Initialize                                 │               │      │  │ (re-cue, escalate)
   fires BASELINE                       ┌───────────┐  STABILIZED    │  └──┐
                                        │  GROWTH   │◀───────────────┘     │
                                        │ Stage IV  │  (recovery aligning)  │
                                        └───────────┘ ◀────────────────────┘
```

* **BASELINE** — establish the physical fact of capability; neutralize self-doubt.
* **INTENTION** — direct energetic focus; prevent energy leakage. *(silent "Track" phase: triggers are armed here)*
* **ENCOUNTER** — hijack the cognitive escape; command a physical override ("breathe", "stay").
* **GROWTH** — capitalize on the newly forged capacity; demand the next edge, then loop.

The machine itself ([`domain/friction-state.ts`](src/domain/friction-state.ts))
is a **pure, side-effect-free transition table**. Illegal transitions throw
`IllegalTransitionError`. The `SessionEngine` is the only component with side
effects.

### The Cue Object (PRD §3)

[`domain/cue.ts`](src/domain/cue.ts) mirrors the PRD schema field-for-field, so a
`Cue[]` validates 1:1 against an on-disk corpus:

```jsonc
{
  "CueID": "encounter.stay",
  "PrimaryState": "ENCOUNTER",
  "PhysicalLever":   "Stack the joints",
  "EnergeticVector": "Channel the breath",
  "StructuralYield": "Capacity to handle asymmetry",
  "AudioTranscript": "Stay. Breathe here. Do not leave the structure…",
  "DeliveryTone": "Sharp, commanding"
}
```

Selection ([`cue-bank/cue-bank.ts`](src/cue-bank/cue-bank.ts)) is a **totally
deterministic** lexicographic ranking — "a strict relational matrix, not
randomized motivation". There is zero `Math.random` in `src/` (enforced by a
test). Tiers: relational lever overlap (weighted by the state's emphasis) →
delivery-tone matrix (state × intensity band) → freshness → `CueID` tie-break.

The **default corpus is the Master Engine Database** — the 20 foundational cues
in [`cue-bank/cue-database.json`](src/cue-bank/cue-database.json), loaded and
**validated on load** via `createDatabaseCueBank()` (→ `CueBank.fromJson` →
`loadCues`). When the engine enters a state it pulls a cue of that state from
this store (entering ENCOUNTER pulls an ENCOUNTER cue). A smaller hand-written
`seed-cues.ts` corpus also exists for examples/tests.

### Trigger modalities (PRD §4)

| | Modality | Module | How it fires |
|---|---|---|---|
| **V1** | Temporal Friction Mapping | [`triggers/temporal-trigger.ts`](src/triggers/temporal-trigger.ts) | Computes tipping points as upward **threshold crossings of the intensity curve** (plus a canonical late-session "end wall") and schedules them via the clock. |
| **V2** | Biometric Telemetry | [`triggers/biometric-trigger.ts`](src/triggers/biometric-trigger.ts) | Rolling **EWMA baseline** → fires on **HR spike** or **HRV drop**, hardened by warmup + N-sample debounce + refractory window. |

Both implement one `Trigger` interface, so the engine treats them uniformly.

### Execution loop (PRD §5)

[`engine/session-engine.ts`](src/engine/session-engine.ts) wires the loop:

```
Initialize → fire BASELINE anchor cue
   ↓ (settle)
Track      → fire INTENTION cue, arm triggers, monitor silently
   ↓ tipping point
Intervene  → transition to ENCOUNTER, cross-reference state machine, select cue
   ↓
Transmit   → TTS delivers the cue (sharp, unpadded)
   ↓
Recalibrate→ await metric stabilization → GROWTH cue → loop to next round
```

---

## Architecture (ports & adapters)

```
            ┌──────────────────────── SessionEngine ────────────────────────┐
            │  (the only side-effecting component; drives the pure FSM)       │
            └───┬───────────┬──────────────┬───────────────┬─────────────────┘
   Clock port ──┘  EventBus ─┘   TTS port ──┘  TelemetrySource ─┘   + CueBank, Triggers
        │             │              │               │
  SystemClock   MemoryEventBus   ConsoleTTS     MockTelemetrySource   ← default/test adapters
  ManualClock                    RecordingTTS                          (swap for real ones)
```

Every timing decision flows through the **`Clock`** port, which is why the whole
engine is deterministically testable: tests use `ManualClock` (virtual time) +
`RecordingTTS` + `MockTelemetrySource` and assert over the `MemoryEventBus` log.

The single integration contract for any consumer is the **`EngineEvent`**
discriminated union ([`domain/events.ts`](src/domain/events.ts)):
`SESSION_STARTED`, `STATE_CHANGED`, `TIPPING_POINT`, `CUE_SELECTED`,
`CUE_SPOKEN`, `RECALIBRATED`, `ROUND_CLEARED`, `DESTABILIZED`, `SESSION_ENDED`,
`ERROR`.

---

## Quick start

Requires **Node ≥ 22.6** (the framework runs `.ts` directly via native
type-stripping — no build step needed to run or test).

```bash
cd backend
npm install          # dev-only deps: typescript, @types/node (zero runtime deps)

npm run demo:temporal    # V1: a 20-minute session, simulated end-to-end instantly
npm run demo:biometric   # V2: a heart-rate spike triggers the intervention
npm run demo:generative  # LLM fallback: a missing-state cue is generated on the fly
npm test                 # node --test (deterministic, virtual-time)
npm run typecheck        # tsc --noEmit
npm run build            # emit dist/ (tsc, rewrites .ts→.js specifiers)
```

### Using it from code

```ts
import { createCompanion } from './src/index.ts';

const { engine, bus } = createCompanion();           // SystemClock + ConsoleTTS by default

bus.on((event) => {
  if (event.type === 'CUE_SELECTED') {
    // render / speak event.cue however the client wants
  }
});

engine.start({
  lengthMs: 20 * 60_000,                 // expected session length (PRD V1 input)
  curve: { kind: 'ramp', peakAt: 0.9 },  // the intensity curve (PRD V1 input)
  enableBiometrics: false,               // set true + pass a telemetry source for V2
});
```

For V2, pass a `telemetry` adapter implementing `TelemetrySource` and set
`enableBiometrics: true`.

---

## PRD → code map

| PRD requirement | Where |
|---|---|
| §2 Friction State Machine (4 states + transitions) | `domain/friction-state.ts` |
| §3 Cue Object schema (exact fields) | `domain/cue.ts` |
| §3 Strict relational selection matrix | `domain/relational.ts` + `cue-bank/cue-bank.ts` |
| Master cue database (default corpus, validated on load) | `cue-bank/cue-database.json` + `cue-bank/cue-database.ts` |
| Seed cue corpus (examples/tests) | `cue-bank/seed-cues.ts` |
| §4 V1 Temporal Friction Mapping | `triggers/temporal-trigger.ts` |
| §4 V2 Biometric Telemetry hook | `triggers/biometric-trigger.ts` + `ports/telemetry-source.ts` |
| §5 Execution loop (Initialize→…→Recalibrate) | `engine/session-engine.ts` |
| §5 Recalibrate (stabilization detection) | `engine/stabilization.ts` |
| §5 Transmit (TTS port) | `ports/tts.ts` (+ `adapters/console-tts.ts`) |
| UI/mobile contract (events) | `domain/events.ts` + `ports/event-bus.ts` |
| Phase 2 generative cue engine (LLM fallback) | `ports/cue-generator.ts` + `generative/anthropic-cue-generator.ts` |
| Phase 2 strict system prompt (YAML) | `generative/system-prompt.ts` |
| Phase 2 spoken-vocabulary guard (code seal) | `generative/output-vocabulary.ts` |
| Friction typology (Velocity/Resource/Alignment/Tension) | `domain/friction-condition.ts` |

---

## Extending

* **Add cues**: edit the JSON store `cue-bank/cue-database.json` (the default
  corpus, validated on load via `createDatabaseCueBank` → `CueBank.fromJson`), or
  load your own JSON with `CueBank.fromJson(...)`. To make the *relational*
  ranking differentiate cues, draw lever phrasings from the controlled vocabulary
  in `domain/relational.ts`; otherwise selection still works deterministically
  via the tone matrix, freshness, and `CueID` tie-break.
* **Real TTS / wearable**: implement `TTS` / `TelemetrySource` and pass them to
  `createCompanion` or `new SessionEngine(...)`.
* **Tune behaviour**: every threshold/window/weight lives in `EngineTuning`
  (`domain/session.ts`) with documented defaults; override per session via
  `SessionConfig.tuning`.

## Extensibility seams (personalization-ready)

The engine is built so a later **personalization layer** (which derives a user
profile at onboarding) can plug in at three independent seams **without any
engine refactor**. Each seam is a port with a behaviour-preserving default, so
V1 runs unchanged until something is injected.

| Seam | Port | Default | A personalization module would… |
|---|---|---|---|
| **Which cue is chosen** | `CueSelector` (`ports/cue-selector.ts`) | `CueBank` (relational matrix) | inject a selector (e.g. a decorator wrapping the `CueBank`, built with the profile) |
| **How the cue is worded** | `CueCalibrator` (`ports/cue-calibrator.ts`) | `IdentityCueCalibrator` (no-op) | inject a calibrator that rewords/tones the chosen cue for the user (must keep `CueID`) |
| **When tipping points fire** | `Trigger` (`triggers/trigger.ts`) + the `TippingPersonalization` hook in `computeTippingPoints` | `TemporalTrigger` / `BiometricTrigger`; no planner (V1 timing) | supply a `TippingPlanner` (via `createCompanion({ tippingPersonalization })` or `new TemporalTrigger(clock, { profile, planner })`) that either **nudges** the default tips or **feeds the computation** from the profile |

The selection/calibration seams receive a `SelectionContext` / `CalibrationContext`
carrying the full situational signal — state, **trigger source**, intensity,
round, history — so neither is coupled to biometric state alone. The engine
depends only on these interfaces; it never references a concrete cue bank or
calibrator. Wire overrides via `createCompanion({ cueSelector, calibrator })` or
the `SessionEngine` constructor.

For timing, the hook is deliberately the **deep** one: `computeTippingPoints`
accepts an optional `TippingPersonalization { profile?, planner? }`. With no
planner it returns **exactly today's tipping points** (the opaque profile is
passed through, never inspected). A `TippingPlanner` receives the profile plus a
`computeDefault()` thunk, so a future module can either nudge the default points
*or* feed the computation itself — neither requires an engine change. All three
seams accept the same opaque `PersonalizationProfile` (`domain/personalization.ts`).

**Live-biometric-reactive timing** (timing that responds to the body mid-session,
not just the profile up front) rides on the existing biometric trigger: the engine
depends on the **`BiometricListener`** interface (`Trigger` + `ingest(sample)`),
not the concrete `BiometricTrigger`. A future module supplies its own
`BiometricListener` whose firing adapts to live signal + profile, injected by
composition — no engine change.

## Generative cue engine (LLM fallback — PRD Phase 2)

When the static corpus has no cue for a state, the engine asks an injected
**`CueGenerator`** (`ports/cue-generator.ts`) for one — the static database stays
the default source. The default implementation,
[`AnthropicCueGenerator`](src/generative/anthropic-cue-generator.ts), calls the
Anthropic Messages API over `fetch` (no SDK dependency), forcing a single
structured cue via tool use. Enable it explicitly:

```ts
import { createCompanion, AnthropicCueGenerator } from './src/index.ts';
const { engine } = createCompanion({
  cueGenerator: new AnthropicCueGenerator(), // reads ANTHROPIC_API_KEY
});
```

- **Strict system prompt:** the YAML spec is set verbatim as the system prompt
  ([`generative/system-prompt.ts`](src/generative/system-prompt.ts)). Its
  highest-priority directive, `Output_Vocabulary_Rule`, lets the model *reason*
  with internal vocabulary (apparatus, Engine, Pilot, operator…) but **never
  speak it** — spoken output is plain somatic language only.
- **Double-sealed:** every generated `AudioTranscript` is re-checked in code by
  `findForbiddenVocabulary` ([`generative/output-vocabulary.ts`](src/generative/output-vocabulary.ts)).
  If an internal term or generic-motivation phrase leaks, the generator
  regenerates; after `maxAttempts` it returns `null` rather than ever speaking a
  leaky cue. The engine then emits a recoverable `ERROR` and continues.
- **Constrained, never generic:** `tool_choice` forces the cue schema, low
  temperature keeps it on-matrix, and `PrimaryState` is set from the request (the
  model never picks the state). Generated cues are interchangeable with database
  cues downstream; `CUE_SELECTED.origin` is `'generated'` vs `'database'`.
- **Model:** defaults to `claude-haiku-4-5` (lowest-latency tier — generation
  must fire near the friction moment). Override via `new AnthropicCueGenerator({ model })`;
  temperature is auto-omitted for models that reject sampling params (Opus 4.7+/Fable).
- **Friction typology:** the request carries an optional `frictionCondition`
  (Velocity/Resource/Alignment/Tension) so the LLM targets the matching cue. The
  biometric trigger tags fires with a rough condition (HR spike → Resource, HRV
  drop → Tension); it's optional everywhere and additive to the PRD.
- **Provider-agnostic:** to use OpenAI instead, implement `CueGenerator` against
  that API — the engine depends only on the port.

### Implementation note

To keep the run-without-a-build-step property, the source avoids TypeScript
features Node's strip-only mode cannot transform: **no `enum`** (use `as const`
unions) and **no constructor parameter properties** (declare fields explicitly).
