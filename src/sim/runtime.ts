/**
 * Simulation runtime: owns the controller model, the simulated external rack conditions,
 * the DCIM telemetry stream, scenario playback and the event bus.
 *
 * Time only moves through `advance(dt)`, so playback is deterministic and pausing is exact.
 * React reads `getSnapshot()` (immutable, changes only on events); the game loop reads live fields.
 */
import { RackSentinelController, TEMP_CLASS, resetBlockers, type ControllerState, type FrameResult, type ResetOutcome } from "./controller";
import { EventBus, type Notice, type NoticeTone, type SimEvents, type TelemetryKind } from "./events";
import { encodeSample } from "./protocol";
import { RecoveryCoordinator, type RecoveryPhase } from "./recovery";
import { SCENARIOS, type Scenario, type ScenarioStep } from "./scenarios";
import { ampsToRaw, degCToRaw, fmtAmps, fmtDegC, voltsToRaw } from "./units";

export interface RawConditions {
  voltRaw: number;
  currentRaw: number;
  tempRaw: number;
}

/** Something that can physically walk to P0 and press it (the scene's operator). */
export interface OperatorAgent {
  /** Walk to P0, release it first if held, press once. Must call runtime.buttonDown(true)/buttonUp(). */
  pressReset(): void;
  /** Abandon any trip or press in progress, letting go of P0 if the finger is on it. */
  cancel(): void;
  /** Walk back to the monitoring station. */
  returnToDesk(): void;
  /** Walking or in the middle of an action. */
  readonly busy: boolean;
}

/** What a scenario is showing right now. */
export interface ScenarioStage {
  title: string;
  detail?: string;
  tone: NoticeTone;
}

export interface SimSnapshot {
  version: number;
  controller: ControllerState;
  conditions: RawConditions;
  streaming: boolean;
  lastSampleAt: number | null;
  p0Down: boolean;
  lastFrame: { kind: TelemetryKind; outcome: FrameResult["outcome"]; reply: number[]; at: number } | null;
  lastReset: { outcome: ResetOutcome; at: number } | null;
  resetBlockers: ResetOutcome[];
  scenario: { id: string; name: string; running: boolean; stage: ScenarioStage | null } | null;
  recovery: RecoveryPhase;
  paused: boolean;
  notices: Notice[];
}

export const STREAM_PERIOD_MS = 3000;
export const PRESS_HOLD_MS = 280;
/** Time after the last scripted step before a scenario with nothing pending is complete. */
export const SCENARIO_TAIL_MS = 1500;
/** How long the "Scenario complete" line stays in the prompt bar. */
const COMPLETE_STAGE_MS = 7000;

export const RESET_MESSAGES: Record<ResetOutcome, { title: string; detail?: string; tone: NoticeTone }> = {
  accepted: { title: "Reset accepted", detail: "Safe conditions verified · EPO request cleared", tone: "ok" },
  "temperature-warm": { title: "Reset refused: temperature is still Warm", detail: "Temperature must be below 27.0 °C", tone: "warn" },
  "temperature-critical": { title: "Reset refused: temperature is Critical", detail: "Temperature must be below 27.0 °C", tone: "alarm" },
  "current-warning": { title: "Reset refused: current remains at warning level", detail: "Current must be below 25.6 A", tone: "warn" },
  held: { title: "Reset refused: P0 was already held", detail: "Release P0 and press again", tone: "warn" },
  "not-latched": { title: "Nothing to reset", detail: "No EPO request is latched", tone: "info" },
  released: { title: "P0 released", tone: "info" },
};

const NORMAL: RawConditions = { voltRaw: 230, currentRaw: 127, tempRaw: 53 };

export class SimulationRuntime {
  readonly bus = new EventBus<SimEvents>();
  readonly controller = new RackSentinelController();

  /** Simulation time in ms. */
  time = 0;
  paused = false;
  conditions: RawConditions = { ...NORMAL };
  streaming = true;
  p0Down = false;
  lastSampleAt: number | null = null;
  agent: OperatorAgent | null = null;
  readonly recovery = new RecoveryCoordinator(this);

  private nextStreamAt = 600;
  private tasks: { at: number; seq: number; run: () => void }[] = [];
  private taskSeq = 0;
  private scenario: { def: Scenario; running: boolean; stepsDone: boolean; stage: ScenarioStage | null; recovering: boolean } | null = null;
  private lastFrame: SimSnapshot["lastFrame"] = null;
  private lastReset: SimSnapshot["lastReset"] = null;
  private notices: Notice[] = [];
  private noticeSeq = 0;
  private quiet = 0;
  private listeners = new Set<() => void>();
  private snap: SimSnapshot;
  private version = 0;

  constructor() {
    this.snap = this.buildSnapshot();
  }

  // ---------------------------------------------------------------- store API (React)
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  private changed() {
    this.version++;
    this.snap = this.buildSnapshot();
    for (const fn of [...this.listeners]) fn();
  }

  private buildSnapshot(): SimSnapshot {
    const c = this.controller.snapshot();
    return {
      version: this.version,
      controller: c,
      conditions: { ...this.conditions },
      streaming: this.streaming,
      lastSampleAt: this.lastSampleAt,
      p0Down: this.p0Down,
      lastFrame: this.lastFrame,
      lastReset: this.lastReset,
      resetBlockers: resetBlockers(c, this.p0Down),
      scenario: this.scenario
        ? { id: this.scenario.def.id, name: this.scenario.def.name, running: this.scenario.running, stage: this.scenario.stage }
        : null,
      recovery: this.recovery.phase,
      paused: this.paused,
      notices: this.notices,
    };
  }

  // ---------------------------------------------------------------- clock
  advance(dtMs: number): void {
    if (this.paused || dtMs <= 0) return;
    const end = this.time + Math.min(dtMs, 250);
    // Run due tasks in time order, letting tasks schedule more tasks inside the window.
    for (;;) {
      const nextTask = this.tasks.length ? this.tasks[0].at : Infinity;
      const nextStream = this.streaming ? this.nextStreamAt : Infinity;
      const next = Math.min(nextTask, nextStream);
      if (next > end) break;
      this.time = next;
      if (nextStream <= nextTask) {
        this.nextStreamAt = this.time + STREAM_PERIOD_MS;
        this.transmit("sample");
      } else {
        this.tasks.shift()!.run();
      }
      this.recovery.update();
    }
    this.time = end;
    this.recovery.update();
  }

  schedule(delayMs: number, run: () => void): void {
    this.tasks.push({ at: this.time + delayMs, seq: this.taskSeq++, run });
    this.tasks.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  /** Run every pending task now, in order (used to skip ahead in the guided demo). */
  flushTasks(): void {
    while (this.tasks.length) {
      const t = this.tasks.shift()!;
      this.time = Math.max(this.time, t.at);
      t.run();
    }
  }

  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    this.changed();
  }

  // ---------------------------------------------------------------- lifecycle
  /**
   * Power-on reset of the controller and the room's simulated conditions. Cancels every pending
   * scenario step and recovery action, calls the operator off and lets go of P0.
   */
  restart(opts: { keepScenario?: boolean; streaming?: boolean } = {}): void {
    this.tasks = [];
    this.recovery.reset();
    this.agent?.cancel();
    this.controller.reset();
    this.conditions = { ...NORMAL };
    this.streaming = opts.streaming ?? true;
    this.nextStreamAt = this.time + 600;
    this.p0Down = false;
    this.lastSampleAt = null;
    this.lastFrame = null;
    this.lastReset = null;
    if (!opts.keepScenario) this.scenario = null;
    this.notices = [];
    this.bus.emit("restart", {});
    this.bus.emit("state", this.controller.snapshot());
    this.changed();
  }

  playScenario(id: string): void {
    const def = SCENARIOS.find((s) => s.id === id);
    if (!def) return;
    this.scenario = { def, running: true, stepsDone: false, stage: null, recovering: false };
    this.restart({ keepScenario: true });
    this.agent?.returnToDesk();
    this.notify(def.name, def.summary, "info");
    this.setStage({ title: "Scenario started", detail: def.summary, tone: "info" });
    this.bus.emit("scenario", { id, phase: "start" });
    const last = def.steps.reduce((m, s) => Math.max(m, s.at), 0);
    for (const step of def.steps) this.schedule(step.at, () => this.runStep(step, false));
    this.schedule(last + SCENARIO_TAIL_MS, () => {
      if (this.scenario?.def !== def) return;
      this.scenario.stepsDone = true;
      this.maybeComplete();
    });
    this.changed();
  }

  /** Show what the running scenario is demonstrating (prompt bar, observer panel). */
  setStage(stage: ScenarioStage | null): void {
    if (!this.scenario?.running || this.quiet) return;
    this.scenario.stage = stage;
    this.changed();
  }

  /** The recovery coordinator has finished (operator heading back to the desk). */
  recoveryFinished(): void {
    this.maybeComplete();
  }

  private maybeComplete(): void {
    const sc = this.scenario;
    if (!sc?.running || !sc.stepsDone || this.recovery.pending) return;
    const epo = this.controller.state.epo;
    const detail = epo
      ? "EPO request still latched."
      : this.controller.state.epoTrips
        ? "EPO request cleared by a new P0 press. Monitoring resumed."
        : "No EPO request was latched, so no reset was needed.";
    sc.stage = { title: "Scenario complete", detail, tone: epo ? "warn" : "ok" };
    sc.running = false;
    this.bus.emit("scenario", { id: sc.def.id, phase: "end" });
    const def = sc.def;
    this.schedule(COMPLETE_STAGE_MS, () => {
      if (this.scenario?.def === def && !this.scenario.running) {
        this.scenario.stage = null;
        this.changed();
      }
    });
    this.changed();
  }

  /** Execute steps immediately and silently (used to rebuild guided-demo state). */
  applyInstant(steps: ScenarioStep[]): void {
    this.quiet++;
    try {
      for (const s of steps) this.runStep(s, true);
    } finally {
      this.quiet--;
    }
    this.changed();
  }

  runStep(step: ScenarioStep, instant: boolean): void {
    switch (step.type) {
      case "conditions":
        this.setConditions({ volts: step.volts ?? 230, amps: step.amps, degC: step.degC }, true);
        break;
      case "recover":
        this.externalRecovery(step);
        break;
      case "corrupt":
        // The corrupted frame carries its own reading; the rack's real conditions are unchanged.
        this.transmit("corrupt", { voltRaw: this.conditions.voltRaw, currentRaw: ampsToRaw(step.amps), tempRaw: degCToRaw(step.degC) });
        break;
      case "invalid":
        this.transmit("invalid");
        break;
      case "press":
        this.pressReset(!instant);
        break;
      case "hold":
        this.buttonDown();
        break;
      case "release":
        if (!this.p0Down) break;
        this.buttonUp();
        this.notify("P0 released", "The held button is free. A new press is needed to acknowledge.", "info");
        this.setStage({ title: "P0 released", detail: "Letting go is not a reset. A new P0 press is required.", tone: "info" });
        break;
      case "stage":
        this.setStage({ title: step.title, detail: step.detail, tone: step.tone ?? "info" });
        break;
      case "acknowledge":
        if (instant || !this.scenario?.running) break;
        this.scenario.recovering = true;
        this.recovery.arm(step.dwell);
        break;
      case "stream":
        this.setStreaming(step.on);
        break;
      case "note":
        this.notify(step.title, step.detail, step.tone ?? "info");
        break;
    }
  }

  /**
   * Simulated external recovery: the rack environment improves (cooling, load shed) and the DCIM
   * terminal sends the new reading. RackSentinel only measures it; P5 never changes a reading.
   */
  private externalRecovery(c: { volts?: number; amps: number; degC: number }): void {
    const sc = this.scenario?.running ? this.scenario : null;
    if (sc && !sc.recovering) this.notify("External rack conditions recovering", "Simulated environment change, sent as a new DCIM sample.", "info");
    if (sc) sc.recovering = true;
    this.setStage({ title: "External conditions recovering", detail: "Simulated rack environment. RackSentinel only measures it.", tone: "info" });
    this.setConditions({ volts: c.volts ?? 230, amps: c.amps, degC: c.degC }, true);
    const s = this.controller.state;
    if (!s.epo) {
      this.setStage({ title: "External conditions recovered", detail: `${fmtDegC(s.latestTemp)} · ${fmtAmps(s.latestCurrent)}. No EPO request, nothing to reset.`, tone: "ok" });
    } else if (s.tempClass === TEMP_CLASS.CRITICAL) {
      this.setStage({ title: `Temperature still Critical · ${fmtDegC(s.latestTemp)}`, detail: "EPO request remains latched.", tone: "alarm" });
    } else if (s.latestCurrent > s.tripCurrent) {
      this.setStage({ title: `Current still trips · ${fmtAmps(s.latestCurrent)}`, detail: "The current fault alone keeps the EPO request.", tone: "alarm" });
    } else if (s.tempClass === TEMP_CLASS.WARM) {
      this.setStage({ title: `Temperature remains Warm at ${fmtDegC(s.latestTemp)}`, detail: "Reset still blocked: temperature must be below 27.0 °C.", tone: "warn" });
    } else if (s.overload) {
      this.setStage({ title: `Current remains Warning at ${fmtAmps(s.latestCurrent)}`, detail: "Reset still blocked: current must be below 25.6 A.", tone: "warn" });
    } else {
      this.setStage({ title: "Conditions are now safe · EPO still latched", detail: "Safe readings alone do not clear P7. Operator acknowledgement required.", tone: "warn" });
    }
  }

  // ---------------------------------------------------------------- telemetry (DCIM → controller)
  setConditions(c: { volts: number; amps: number; degC: number }, sendNow: boolean): void {
    this.setRawConditions({ voltRaw: voltsToRaw(c.volts), currentRaw: ampsToRaw(c.amps), tempRaw: degCToRaw(c.degC) }, sendNow);
  }

  setRawConditions(c: RawConditions, sendNow: boolean): void {
    this.conditions = {
      voltRaw: clampByte(c.voltRaw),
      currentRaw: clampByte(c.currentRaw),
      tempRaw: clampByte(c.tempRaw),
    };
    if (sendNow) this.transmit("sample");
    else this.changed();
  }

  setStreaming(on: boolean): void {
    if (this.streaming === on) return;
    this.streaming = on;
    this.nextStreamAt = this.time + (on ? 400 : 0);
    if (on) this.notify("Telemetry resumed", "The DCIM terminal is sending samples again.", "info");
    else this.notify("Telemetry stopped", "Controller holds its last valid state. P0 still works locally.", "warn");
    this.changed();
  }

  /** Send one packet from the DCIM terminal and process the controller's reply. */
  transmit(kind: TelemetryKind, reading: RawConditions = this.conditions): FrameResult {
    const { voltRaw, currentRaw, tempRaw } = reading;
    const frame =
      kind === "invalid"
        ? encodeSample(voltRaw, currentRaw, 0) // temperature raw 0 is a sensor fault
        : encodeSample(voltRaw, currentRaw, tempRaw, kind === "corrupt");
    if (kind === "sample" && this.streaming) this.nextStreamAt = this.time + STREAM_PERIOD_MS;

    const before = this.controller.snapshot();
    const result = this.controller.receiveFrame(frame);
    const after = this.controller.snapshot();
    this.lastSampleAt = this.time;
    this.lastFrame = { kind, outcome: result.outcome, reply: result.reply, at: this.time };
    if (!this.quiet) this.bus.emit("telemetry", { kind, result });
    this.describeTransition(before, after, result);
    this.bus.emit("state", after);
    this.changed();
    return result;
  }

  private describeTransition(b: ControllerState, a: ControllerState, r: FrameResult): void {
    if (r.outcome === "invalid") {
      this.notify("Telemetry rejected (0x3C)", "Invalid reading. Readings, outputs and the EPO latch are unchanged.", "warn");
      return;
    }
    if (r.outcome === "bad-crc") {
      this.notify("Corrupted message rejected (0x5A)", "Bad CRC. Nothing was acted on; the reject counter went up.", "warn");
      return;
    }
    if (r.outcome !== "accepted") return;

    const tripCurrent = a.latestCurrent > a.tripCurrent;
    const tripTemp = a.tempClass === TEMP_CLASS.CRITICAL;
    if (!b.epo && a.epo) {
      if (!this.quiet) this.bus.emit("trip", { temperature: tripTemp, current: tripCurrent });
      const cause = [tripTemp && `critical temperature ${fmtDegC(a.latestTemp)}`, tripCurrent && `current trip ${fmtAmps(a.latestCurrent)}`]
        .filter(Boolean)
        .join(" + ");
      this.notify("EPO request latched", `P7 on: ${cause}. Safe readings alone will not clear it.`, "alarm");
      if (tripTemp) this.setStage({ title: "Maximum fan requested (P5) · EPO latched", detail: "Temperature remains controlled by external rack conditions.", tone: "alarm" });
      else this.setStage({ title: "Current trip · EPO request latched", detail: "Current is set by the external load. P7 stays latched.", tone: "alarm" });
      return;
    }
    if (a.tempClass !== b.tempClass) {
      if (a.tempClass === TEMP_CLASS.WARM && a.epo && b.tempClass === TEMP_CLASS.CRITICAL) {
        this.notify(`Temperature remains Warm at ${fmtDegC(a.latestTemp)}`, "P4 fan boost. Reset still blocked: EPO request remains latched.", "warn");
      } else if (a.tempClass === TEMP_CLASS.WARM) {
        if (!this.quiet && b.tempClass === TEMP_CLASS.NORMAL) this.bus.emit("warning", { what: "warm" });
        this.notify(`Rack Warm · ${fmtDegC(a.latestTemp)}`, "P4 fan boost requested.", "warn");
      } else if (a.tempClass === TEMP_CLASS.CRITICAL) {
        this.notify(`Temperature Critical · ${fmtDegC(a.latestTemp)}`, "P5 maximum fan requested. EPO request remains latched.", "alarm");
      } else {
        this.notify(`Temperature Normal · ${fmtDegC(a.latestTemp)}`, a.epo ? "Fan requests off. EPO request remains latched." : "Fan requests off.", "info");
      }
    }
    if (a.epo && b.latestCurrent > b.tripCurrent && a.overload && a.latestCurrent <= a.tripCurrent) {
      this.notify(`Current remains Warning at ${fmtAmps(a.latestCurrent)}`, "No longer a trip, but reset stays blocked until current is below 25.6 A.", "warn");
    }
    if (a.overload !== b.overload) {
      if (a.overload) {
        if (!this.quiet) this.bus.emit("warning", { what: "current" });
        this.notify(`Current warning · ${fmtAmps(a.latestCurrent)}`, "P6 current warning on (at or above 25.6 A).", "warn");
      } else {
        this.notify(`Current below warning · ${fmtAmps(a.latestCurrent)}`, "P6 current warning off.", "info");
      }
    }
    const safe = (s: ControllerState) => s.tempClass === TEMP_CLASS.NORMAL && !s.overload;
    if (a.epo && safe(a) && !safe(b)) {
      // The firmware polls P0 continuously; a button that is still down never makes a new edge.
      if (this.p0Down) this.notify(RESET_MESSAGES.held.title, `Readings are safe. ${RESET_MESSAGES.held.detail}.`, "warn");
      else this.notify("Conditions are now safe · EPO request remains latched", "Operator acknowledgement required: a new P0 press at the rack.", "warn");
    }
  }

  // ---------------------------------------------------------------- P0 (operator reset button)
  /**
   * Press P0 once. Via the operator when one is present, otherwise directly: as a headless
   * stand-in for the operator when `viaOperator`, as a raw user press when not.
   */
  pressReset(viaOperator = true): void {
    if (viaOperator && this.agent) {
      this.agent.pressReset();
      return;
    }
    if (this.p0Down) this.buttonUp();
    this.buttonDown(viaOperator);
    if (this.quiet) this.buttonUp();
    else this.schedule(PRESS_HOLD_MS, () => this.buttonUp());
  }

  /** P0 goes down. `fromOperator` marks the operator's finger (scene or headless stand-in). */
  buttonDown(fromOperator = false): void {
    const wasDown = this.p0Down;
    this.p0Down = true;
    const attempt = this.controller.setP0(true);
    if (!this.quiet) this.bus.emit("button", { down: true });
    if (fromOperator) this.recovery.onOperatorPress();
    if (!wasDown || attempt.newPress) this.recordReset(attempt.outcome, fromOperator);
    this.bus.emit("state", this.controller.snapshot());
    this.changed();
  }

  buttonUp(): void {
    if (!this.p0Down) return;
    this.p0Down = false;
    this.controller.setP0(false);
    if (!this.quiet) this.bus.emit("button", { down: false });
    this.changed();
  }

  private recordReset(outcome: ResetOutcome, fromOperator = false): void {
    this.lastReset = { outcome, at: this.time };
    if (!this.quiet) this.bus.emit("reset", { outcome });
    const m = RESET_MESSAGES[outcome];
    // A hold that starts with nothing latched is not a reset attempt worth announcing.
    if (outcome === "not-latched" && this.scenario?.def.id === "held-button") {
      this.notify("P0 held down", "The reset button is stuck in the pressed position.", "info");
      this.setStage({ title: "P0 held down", detail: "The reset button is stuck in the pressed position.", tone: "info" });
      return;
    }
    this.notify(m.title, m.detail, m.tone);
    if (outcome !== "accepted" && outcome !== "not-latched") this.setStage({ title: m.title, detail: m.detail, tone: m.tone });
    this.recovery.onReset(outcome, fromOperator);
  }

  // ---------------------------------------------------------------- notices
  notify(title: string, detail: string | undefined, tone: NoticeTone): void {
    if (this.quiet) return;
    const n: Notice = { id: ++this.noticeSeq, title, detail, tone, at: this.time };
    this.notices = [...this.notices.slice(-3), n];
    this.bus.emit("notice", n);
  }

  dismissNotice(id: number): void {
    const next = this.notices.filter((n) => n.id !== id);
    if (next.length === this.notices.length) return;
    this.notices = next;
    this.changed();
  }
}

function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
