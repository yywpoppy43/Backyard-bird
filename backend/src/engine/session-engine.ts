/**
 * SessionEngine — the executable loop of PRD §5 "System Execution Flow".
 *
 *   Initialize  → fire BASELINE anchor cue
 *   (advance)   → fire INTENTION cue, then arm triggers
 *   Track       → silent monitoring (temporal timers + biometric ingest)
 *   Intervene   → tipping point detected → ENCOUNTER, select cue
 *   Transmit    → TTS delivers the cue
 *   Recalibrate → await stabilization → GROWTH cue → loop to the next round
 *
 * The engine is the ONLY component with side effects and the ONLY caller of the
 * pure {@link nextState} transition function. It is fully event-loop driven by
 * the injected {@link Clock} and telemetry callbacks — there is no internal
 * polling loop. It never throws to its caller during a run; everything surfaces
 * as an {@link EngineEvent} on the {@link EventBus}.
 */

import type { Millis, Unit } from '../domain/units.ts';
import { clamp01 } from '../domain/units.ts';
import {
  FrictionState,
  FrictionEvent,
  nextState,
  IllegalTransitionError,
} from '../domain/friction-state.ts';
import type { Cue } from '../domain/cue.ts';
import {
  intensityAt,
  resolveTuning,
  validateSessionConfig,
  type EngineTuning,
  type SessionConfig,
} from '../domain/session.ts';
import {
  deriveRelationalTarget,
  reinforceOverride,
  rotateOverride,
  type RelationalOverride,
} from '../domain/relational.ts';
import type { EngineEvent } from '../domain/events.ts';
import type { Clock, TimerHandle } from '../ports/clock.ts';
import type { EventBus } from '../ports/event-bus.ts';
import type { TTS } from '../ports/tts.ts';
import type { TelemetrySource, BiometricSample } from '../ports/telemetry-source.ts';
import type { Trigger, TriggerSignal, TriggerArmContext, TriggerSource } from '../triggers/trigger.ts';
import type { BiometricListener } from '../triggers/biometric-trigger.ts';
import type { CueSelector, SelectionContext } from '../ports/cue-selector.ts';
import type { CueCalibrator } from '../ports/cue-calibrator.ts';
import type { CueGenerator, GenerationOutcome } from '../ports/cue-generator.ts';
import { safeDefaultCue } from '../cue-bank/safe-defaults.ts';
import type { FrictionCondition } from '../domain/friction-condition.ts';
import { StabilizationDetector, type StabilizationOutcome } from './stabilization.ts';

/** Source attribution for a cue: a proactive lifecycle cue, or a trigger fire. */
type CueSource = TriggerSource | 'INIT';

export interface SessionEngineDeps {
  clock: Clock;
  tts: TTS;
  bus: EventBus;
  /** Cue-selection seam. The default is a {@link CueBank}; a personalization
   *  layer can supply its own selector to influence which cue is chosen. */
  cueSelector: CueSelector;
  /** Cue-wording seam. Defaults to an identity pass-through; a personalization
   *  layer can supply a calibrator to reword/tone a cue for a specific user. */
  calibrator?: CueCalibrator;
  /** Generative seam (PRD Phase 2). When the selector returns no cue for a
   *  state, the engine asks this generator (an LLM) for one. Optional. */
  cueGenerator?: CueGenerator;
  /** The temporal (V1) trigger — always present. */
  temporal: Trigger;
  /** The biometric (V2) trigger — required to use `enableBiometrics`. */
  biometric?: BiometricListener;
  /** The biometric telemetry source — required to use `enableBiometrics`. */
  telemetry?: TelemetrySource;
}

interface EngineTimers {
  end?: TimerHandle;
  settle?: TimerHandle;
  cooldown?: TimerHandle;
  recalMax?: TimerHandle;
  recalGrace?: TimerHandle;
}

export class SessionEngine {
  private readonly clock: Clock;
  private readonly tts: TTS;
  private readonly bus: EventBus;
  private readonly cueSelector: CueSelector;
  private readonly calibrator: CueCalibrator;
  private readonly cueGenerator: CueGenerator | undefined;
  private readonly temporal: Trigger;
  private readonly biometric: BiometricListener | undefined;
  private readonly telemetry: TelemetrySource | undefined;

  private running = false;
  private state: FrictionState = FrictionState.BASELINE;
  private round = 1;
  private config!: SessionConfig;
  private tuning!: EngineTuning;
  private useBiometrics = false;
  private sessionStartedAt = 0;

  private currentIntensity: Unit = 0;
  private currentSource: CueSource = 'INIT';
  private currentFrictionCondition: FrictionCondition | undefined;
  private lastCue: Cue | null = null;
  private lastCueId: string | null = null;
  private recentCueIds: string[] = [];
  private readonly lastSpokenAt = new Map<string, Millis>();
  private consecutiveDestabilizations = 0;
  private relationalOverride: RelationalOverride = {};

  private lastSample: BiometricSample | null = null;
  private stabilizer!: StabilizationDetector;
  private recalActive = false;

  private timers: EngineTimers = {};
  private ttsAbort: AbortController | null = null;

  constructor(deps: SessionEngineDeps) {
    this.clock = deps.clock;
    this.tts = deps.tts;
    this.bus = deps.bus;
    this.cueSelector = deps.cueSelector;
    // Default cue-wording seam: identity pass-through (no external dependency).
    this.calibrator = deps.calibrator ?? { calibrate: (cue) => cue };
    this.cueGenerator = deps.cueGenerator;
    this.temporal = deps.temporal;
    this.biometric = deps.biometric;
    this.telemetry = deps.telemetry;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get isRunning(): boolean {
    return this.running;
  }
  get currentState(): FrictionState {
    return this.state;
  }
  get currentRound(): number {
    return this.round;
  }

  /** PRD §5 "Initialize". Validates config, then fires the BASELINE anchor. */
  start(config: SessionConfig): void {
    if (this.running) throw new Error('SessionEngine is already running.');
    validateSessionConfig(config);

    this.config = config;
    this.tuning = resolveTuning(config.tuning);
    this.useBiometrics = config.enableBiometrics === true && this.biometric !== undefined;

    this.running = true;
    this.state = FrictionState.BASELINE;
    this.round = 1;
    this.sessionStartedAt = this.clock.now();
    this.currentIntensity = intensityAt(config.curve, 0);
    this.currentSource = 'INIT';
    this.currentFrictionCondition = undefined;
    this.lastCue = null;
    this.lastCueId = null;
    this.recentCueIds = [];
    this.lastSpokenAt.clear();
    this.consecutiveDestabilizations = 0;
    this.relationalOverride = {};
    this.lastSample = null;
    this.recalActive = false;
    this.timers = {};
    this.stabilizer = new StabilizationDetector(this.tuning);

    // Wire triggers (fresh per session).
    this.temporal.reset();
    this.temporal.onTip((s) => this.onTip(s));
    if (this.biometric) {
      this.biometric.reset();
      this.biometric.onTip((s) => this.onTip(s));
    }
    if (this.useBiometrics && this.telemetry) {
      this.telemetry.start((s) => this.onSample(s));
    }

    this.emit({ type: 'SESSION_STARTED', config, at: this.now() });

    // Hard session-length deadline.
    this.timers.end = this.clock.setTimer(config.lengthMs, () => this.end('completed'));

    // Initialize: BASELINE anchor cue, then advance to INTENTION after settling.
    void this.cueAndContinue('INIT', this.currentIntensity, () => {
      this.timers.settle = this.clock.setTimer(this.tuning.baselineSettleMs, () =>
        this.advanceToIntention(),
      );
    });
  }

  /** Stop the session immediately (PRD lifecycle). Idempotent. */
  stop(): void {
    this.end('stopped');
  }

  // ── Lifecycle stages ────────────────────────────────────────────────────

  private advanceToIntention(): void {
    if (!this.running) return;
    if (!this.dispatch(FrictionEvent.ADVANCE)) return;
    this.enterIntention();
  }

  /** PRD §5 "Track" begins here: fire the INTENTION cue, then arm triggers. */
  private enterIntention(): void {
    if (!this.running) return;
    const intensity = intensityAt(this.config.curve, this.progress());
    this.currentIntensity = intensity;
    void this.cueAndContinue('INIT', intensity, () => this.armForRound());
  }

  private armForRound(): void {
    if (!this.running) return;
    const ctx: TriggerArmContext = {
      round: this.round,
      sessionStartedAt: this.sessionStartedAt,
      config: this.config,
    };
    this.temporal.arm(ctx);
    if (this.useBiometrics) this.biometric?.arm(ctx);
  }

  /** PRD §5 "Intervene". A trigger fired during the silent monitoring phase. */
  private onTip(signal: TriggerSignal): void {
    if (!this.running) return;
    if (this.state !== FrictionState.INTENTION) return; // single-flight: only from Track

    this.temporal.disarm();
    this.biometric?.disarm();

    this.currentIntensity = signal.intensity;
    this.currentSource = signal.source;
    this.currentFrictionCondition = signal.frictionCondition;
    this.consecutiveDestabilizations = 0;
    this.emit({
      type: 'TIPPING_POINT',
      source: signal.source,
      intensity: signal.intensity,
      reason: signal.reason,
      frictionCondition: signal.frictionCondition,
      round: this.round,
      at: this.now(),
    });

    if (!this.dispatch(FrictionEvent.TIPPING_POINT_DETECTED)) return;
    this.enterEncounter(signal.intensity);
  }

  /** PRD §5 "Transmit": select + speak the ENCOUNTER cue, then recalibrate. */
  private enterEncounter(intensity: Unit): void {
    if (!this.running) return;
    this.currentIntensity = intensity;
    void this.cueAndContinue(this.currentSource, intensity, () => this.beginRecalibration());
  }

  /** PRD §5 "Recalibrate": await metric stabilization. */
  private beginRecalibration(): void {
    if (!this.running) return;
    this.stabilizer.begin(this.lastSample, this.now());
    this.recalActive = true;

    // Hard cap so ENCOUNTER can never hang on a dead sensor.
    this.timers.recalMax = this.clock.setTimer(this.tuning.recalMaxWaitMs, () =>
      this.resolveStabilization('STABILIZED', 'maxwait'),
    );
    // V1 time-only path: no biometrics to observe, so resolve on the grace timer.
    if (!this.useBiometrics) {
      this.timers.recalGrace = this.clock.setTimer(this.tuning.recalGraceMs, () =>
        this.resolveStabilization('STABILIZED', 'grace'),
      );
    }
  }

  private resolveStabilization(outcome: StabilizationOutcome, _why: string): void {
    if (!this.running) return;
    if (this.state !== FrictionState.ENCOUNTER) return; // stale-timer guard
    if (outcome === 'PENDING') return;

    this.recalActive = false;
    this.clearTimer('recalMax');
    this.clearTimer('recalGrace');
    const metric = this.stabilizer.metric;

    if (outcome === 'DESTABILIZED') {
      this.consecutiveDestabilizations += 1;
      if (this.consecutiveDestabilizations < this.tuning.maxConsecutiveEncounters) {
        this.relationalOverride = rotateOverride(this.relationalOverride, FrictionState.ENCOUNTER);
        this.emit({
          type: 'DESTABILIZED',
          round: this.round,
          attempt: this.consecutiveDestabilizations,
          at: this.now(),
        });
        this.emit({ type: 'RECALIBRATED', stabilized: false, metric, round: this.round, at: this.now() });
        // Re-cue ENCOUNTER, escalated (self-loop).
        const escalated = clamp01(
          this.currentIntensity + this.tuning.escalationStep * this.consecutiveDestabilizations,
        );
        if (!this.dispatch(FrictionEvent.DESTABILIZED)) return;
        this.enterEncounter(escalated);
        return;
      }
      // Give-up ceiling reached: advance gracefully rather than nag forever.
      this.emit({
        type: 'ERROR',
        scope: 'escalation',
        message: 'max consecutive ENCOUNTER pushes reached; advancing to GROWTH',
        recoverable: true,
        at: this.now(),
      });
    }

    // STABILIZED (or graceful give-up): consolidate and demand the next edge.
    if (this.lastCue && this.lastCue.PrimaryState === FrictionState.ENCOUNTER) {
      this.relationalOverride = reinforceOverride(
        this.relationalOverride,
        FrictionState.ENCOUNTER,
        this.lastCue,
      );
    }
    this.emit({ type: 'RECALIBRATED', stabilized: true, metric, round: this.round, at: this.now() });
    if (!this.dispatch(FrictionEvent.STABILIZED)) return;
    this.consecutiveDestabilizations = 0;
    this.emit({ type: 'ROUND_CLEARED', round: this.round, at: this.now() });
    this.enterGrowth();
  }

  /** PRD §2 State 4: demand an expansion of the edge, then loop to next round. */
  private enterGrowth(): void {
    if (!this.running) return;
    void this.cueAndContinue(this.currentSource, this.currentIntensity, () => this.scheduleNextRound());
  }

  private scheduleNextRound(): void {
    if (!this.running) return;
    if (this.config.maxRounds !== undefined && this.round >= this.config.maxRounds) {
      this.end('completed');
      return;
    }
    this.timers.cooldown = this.clock.setTimer(this.tuning.interRoundCooldownMs, () =>
      this.nextRound(),
    );
  }

  private nextRound(): void {
    if (!this.running) return;
    this.round += 1;
    if (!this.dispatch(FrictionEvent.NEXT_ROUND)) return;
    this.enterIntention();
  }

  // ── Telemetry ingestion ──────────────────────────────────────────────────

  private onSample(sample: BiometricSample): void {
    if (!this.running) return;
    this.lastSample = sample;
    // Keep the baseline warm in every state; the trigger only fires while armed.
    this.biometric?.ingest(sample);
    if (this.recalActive && this.state === FrictionState.ENCOUNTER) {
      const outcome = this.stabilizer.observe(sample);
      if (outcome !== 'PENDING') this.resolveStabilization(outcome, 'biometric');
    }
  }

  // ── Cue selection + transmission ─────────────────────────────────────────

  /**
   * Select the best cue for the current state and speak it, then run `after`.
   * Never strands the session: if no cue is available or TTS fails, it emits a
   * recoverable ERROR and still continues the lifecycle.
   */
  private async cueAndContinue(source: CueSource, intensity: Unit, after: () => void): Promise<void> {
    if (!this.running) return;
    const state = this.state;
    const target = deriveRelationalTarget(state, intensity, this.relationalOverride);
    const ctx: SelectionContext = {
      targetState: state,
      source,
      intensity,
      round: this.round,
      now: this.now(),
      lastCueId: this.lastCueId,
      recentCueIds: [...this.recentCueIds],
      target,
      lastSpokenAt: this.lastSpokenAt,
    };

    // Shared cancellation for generation + transmission; end() aborts it.
    const abort = new AbortController();
    this.ttsAbort = abort;

    // Cue-SELECTION seam: which cue fires (default = deterministic CueBank).
    let selected = this.cueSelector.select(ctx);
    let origin: 'database' | 'generated' | 'fallback' = 'database';

    // Generative seam (PRD Phase 2): if the static corpus has no cue for this
    // state, ask the LLM generator for one. Static remains the default source.
    if (!selected && this.cueGenerator) {
      const outcome = await this.generateSafely(state, source, intensity, abort.signal);
      if (!this.running) return;
      // Always surface what generation did (ok / regenerated / failed) so the
      // generative layer is observable for tuning.
      this.emit({
        type: 'CUE_GENERATION',
        state,
        status: outcome.status,
        attempts: outcome.attempts,
        networkRetries: outcome.networkRetries,
        reason: outcome.reason,
        round: this.round,
        at: this.now(),
      });
      if (outcome.cue) {
        selected = outcome.cue;
        origin = 'generated';
      }
    }

    // Last resort: never go quiet at a cue point. If neither the corpus nor the
    // generator produced a cue, speak the hand-authored safe default for the
    // state and surface it as a recoverable error for observability/tuning.
    if (!selected) {
      const fallback = safeDefaultCue(state);
      this.emit({
        type: 'ERROR',
        scope: 'cue-fallback',
        message: `no cue available for state ${state}; using safe default ${fallback.CueID}`,
        recoverable: true,
        at: this.now(),
      });
      selected = fallback;
      origin = 'fallback';
    }

    // Cue-WORDING seam: how the cue is phrased/toned (default = identity).
    const cue = this.calibrator.calibrate(selected, { state, source, intensity, round: this.round });

    this.emit({ type: 'CUE_SELECTED', cue, state, origin, round: this.round, at: this.now() });

    try {
      const result = await this.tts.speak(
        { cueId: cue.CueID, text: cue.AudioTranscript, tone: cue.DeliveryTone },
        abort.signal,
      );
      if (!this.running) return;
      this.recordSpoken(cue);
      this.emit({ type: 'CUE_SPOKEN', cueId: cue.CueID, result, round: this.round, at: this.now() });
    } catch (err) {
      if (!this.running) return;
      this.emit({
        type: 'ERROR',
        scope: 'tts',
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
        at: this.now(),
      });
    }
    after();
  }

  /**
   * Call the generator without ever letting it throw into the lifecycle. A
   * well-behaved generator already returns a {@link GenerationOutcome}; this also
   * converts an unexpected throw (a misbehaving custom generator) into an `error`
   * outcome, so the engine has exactly one shape to handle and always reaches the
   * safe-default fallback rather than stranding the session.
   */
  private async generateSafely(
    state: FrictionState,
    source: CueSource,
    intensity: Unit,
    signal: AbortSignal,
  ): Promise<GenerationOutcome> {
    try {
      return await this.cueGenerator!.generate(
        {
          state,
          source,
          intensity,
          round: this.round,
          frictionCondition: this.currentFrictionCondition,
        },
        signal,
      );
    } catch (err) {
      return {
        cue: null,
        status: 'error',
        attempts: 0,
        networkRetries: 0,
        reason: `generator threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private recordSpoken(cue: Cue): void {
    this.lastCue = cue;
    this.lastCueId = cue.CueID;
    this.lastSpokenAt.set(cue.CueID, this.now());
    this.recentCueIds.push(cue.CueID);
    while (this.recentCueIds.length > this.tuning.recentCueCap) this.recentCueIds.shift();
  }

  // ── State machine + lifecycle plumbing ───────────────────────────────────

  /** Apply a transition. Returns false (and ends the session) on illegal input. */
  private dispatch(event: FrictionEvent): boolean {
    const from = this.state;
    let to: FrictionState;
    try {
      to = nextState(from, event);
    } catch (err) {
      const message = err instanceof IllegalTransitionError ? err.message : String(err);
      this.emit({ type: 'ERROR', scope: 'transition', message, recoverable: false, at: this.now() });
      this.end('error');
      return false;
    }
    this.state = to;
    this.emit({ type: 'STATE_CHANGED', from, to, cause: event, round: this.round, at: this.now() });
    return true;
  }

  private end(reason: 'completed' | 'stopped' | 'error'): void {
    if (!this.running) return;
    this.running = false;
    this.recalActive = false;
    this.temporal.disarm();
    this.biometric?.disarm();
    this.telemetry?.stop();
    this.ttsAbort?.abort();
    this.clearTimer('end');
    this.clearTimer('settle');
    this.clearTimer('cooldown');
    this.clearTimer('recalMax');
    this.clearTimer('recalGrace');
    this.emit({ type: 'SESSION_ENDED', reason, rounds: this.round, at: this.now() });
  }

  private clearTimer(key: keyof EngineTimers): void {
    const handle = this.timers[key];
    if (handle) {
      this.clock.clearTimer(handle);
      this.timers[key] = undefined;
    }
  }

  private progress(): Unit {
    return clamp01((this.now() - this.sessionStartedAt) / this.config.lengthMs);
  }

  private now(): Millis {
    return this.clock.now();
  }

  private emit(event: EngineEvent): void {
    this.bus.emit(event);
  }
}
