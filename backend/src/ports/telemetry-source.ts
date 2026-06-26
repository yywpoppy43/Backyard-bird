/**
 * Telemetry source port — PRD §4 "Biometric Telemetry (V2 API Hook)".
 *
 * "The system ingests real-time external data (e.g. heart rate spikes or Heart
 * Rate Variability drops indicating systemic stress)."
 *
 * This is the inbound seam for that real-time data. A concrete adapter wraps a
 * wearable SDK, a BLE heart-rate monitor, a WebSocket feed, etc. The framework
 * ships a scripted {@link MockTelemetrySource} so the biometric path is fully
 * exercisable without hardware.
 */

import type { Millis, Unit } from '../domain/units.ts';

/** A single biometric reading. All metrics are optional so partial sensors work. */
export interface BiometricSample {
  /** Sample timestamp (clock ms). Samples must arrive monotonically. */
  t: Millis;
  /** Heart rate, beats per minute. */
  hr?: number;
  /** Heart Rate Variability (RMSSD-style), milliseconds. Lower = more stress. */
  hrvMs?: number;
  /** Optional motion/effort proxy (e.g. accelerometer magnitude). */
  motion?: number;
  /** Optional signal-quality estimate in [0,1]; low-quality samples are dropped. */
  quality?: Unit;
}

export interface TelemetrySource {
  /**
   * Begin streaming. `onSample` is invoked for every reading until {@link stop}.
   * Calling `start` twice without an intervening `stop` is implementation-defined;
   * adapters should treat the latest callback as authoritative.
   */
  start(onSample: (sample: BiometricSample) => void): void;
  /** Stop streaming and release any underlying resources. Idempotent. */
  stop(): void;
}
