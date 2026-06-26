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
  "PhysicalLever_Metal":   "Stack the joints",
  "EnergeticVector_Water": "Channel the breath",
  "StructuralYield_Wood":  "Capacity to handle asymmetry",
  "AudioTranscript": "Stay. Breathe here. Do not leave the structure…",
  "DeliveryTone": "Sharp, commanding"
}
```

Selection ([`cue-bank/cue-bank.ts`](src/cue-bank/cue-bank.ts)) is a **totally
deterministic** lexicographic ranking — "a strict relational matrix, not
randomized motivation". There is zero `Math.random` in `src/` (enforced by a
test). Tiers: relational lever overlap (weighted by the state's emphasis) →
delivery-tone matrix (state × intensity band) → freshness → `CueID` tie-break.

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
| Seed cue corpus | `cue-bank/seed-cues.ts` |
| §4 V1 Temporal Friction Mapping | `triggers/temporal-trigger.ts` |
| §4 V2 Biometric Telemetry hook | `triggers/biometric-trigger.ts` + `ports/telemetry-source.ts` |
| §5 Execution loop (Initialize→…→Recalibrate) | `engine/session-engine.ts` |
| §5 Recalibrate (stabilization detection) | `engine/stabilization.ts` |
| §5 Transmit (TTS port) | `ports/tts.ts` (+ `adapters/console-tts.ts`) |
| UI/mobile contract (events) | `domain/events.ts` + `ports/event-bus.ts` |

---

## Extending

* **Add cues**: append PRD-shaped objects to `cue-bank/seed-cues.ts` (or load
  JSON via `CueBank.fromJson`). Lever phrasings should use the controlled
  vocabulary in `domain/relational.ts` so the relational matrix differentiates
  them. The corpus is validated at construction.
* **Real TTS / wearable**: implement `TTS` / `TelemetrySource` and pass them to
  `createCompanion` or `new SessionEngine(...)`.
* **Tune behaviour**: every threshold/window/weight lives in `EngineTuning`
  (`domain/session.ts`) with documented defaults; override per session via
  `SessionConfig.tuning`.

### Implementation note

To keep the run-without-a-build-step property, the source avoids TypeScript
features Node's strip-only mode cannot transform: **no `enum`** (use `as const`
unions) and **no constructor parameter properties** (declare fields explicitly).
