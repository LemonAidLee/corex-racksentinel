import type { ControllerState, FrameResult, ResetOutcome } from "./controller";

export type NoticeTone = "info" | "ok" | "warn" | "alarm";

export interface Notice {
  id: number;
  title: string;
  detail?: string;
  tone: NoticeTone;
  /** Simulation time (ms) when the notice was raised. */
  at: number;
}

export type TelemetryKind = "sample" | "corrupt" | "invalid";

/** Everything the simulation announces. Scene, sound, UI and accessibility layers subscribe. */
export interface SimEvents {
  /** A packet travelled from the DCIM terminal to the controller and was processed. */
  telemetry: { kind: TelemetryKind; result: FrameResult };
  /** A new EPO latch (P7 rising). */
  trip: { temperature: boolean; current: boolean };
  /** A warning-level change that the operator should notice (warm or current warning newly active). */
  warning: { what: "warm" | "current" };
  /** A P0 press was evaluated. */
  reset: { outcome: ResetOutcome };
  /** P0 level changed. */
  button: { down: boolean };
  notice: Notice;
  /** Controller state changed (cheap: fired after packets and P0 polls). */
  state: ControllerState;
  scenario: { id: string; phase: "start" | "end" };
  /** The simulation was restarted from power-on. */
  restart: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<E[K]>)(payload);
  }
}
