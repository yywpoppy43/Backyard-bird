/**
 * EventBus port — the outbound seam carrying {@link EngineEvent}s to consumers.
 *
 * The engine emits; a UI/mobile/logger subscribes via {@link EventBus.on}, which
 * returns an unsubscribe function. A correct implementation isolates handler
 * exceptions so one misbehaving subscriber cannot break the session loop.
 *
 * @see MemoryEventBus — the default in-process implementation.
 */

import type { EngineEvent } from '../domain/events.ts';

export type EngineEventHandler = (event: EngineEvent) => void;

export interface EventBus {
  /** Publish an event to all current subscribers. */
  emit(event: EngineEvent): void;
  /** Subscribe; returns a function that unsubscribes the handler. */
  on(handler: EngineEventHandler): () => void;
}
