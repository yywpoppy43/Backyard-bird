/**
 * In-process {@link EventBus}. This is both the default a UI/mobile client
 * subscribes to and the assertion surface for tests (every event is retained in
 * {@link log}). Handler exceptions are isolated so one bad subscriber cannot
 * break the session loop.
 */

import type { EngineEvent } from '../domain/events.ts';
import type { EventBus, EngineEventHandler } from '../ports/event-bus.ts';

export interface MemoryEventBusOptions {
  onHandlerError?: (err: unknown, event: EngineEvent) => void;
}

export class MemoryEventBus implements EventBus {
  private readonly handlers = new Set<EngineEventHandler>();
  /** Chronological record of every emitted event. */
  readonly log: EngineEvent[] = [];
  private readonly opts: MemoryEventBusOptions;

  constructor(opts: MemoryEventBusOptions = {}) {
    this.opts = opts;
  }

  emit(event: EngineEvent): void {
    this.log.push(event);
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch (err) {
        this.opts.onHandlerError?.(err, event);
      }
    }
  }

  on(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Typed filter over the log by event type. */
  ofType<T extends EngineEvent['type']>(type: T): Extract<EngineEvent, { type: T }>[] {
    return this.log.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
  }

  clear(): void {
    this.log.length = 0;
  }
}
