/**
 * Simulation runtime: owns the controller model, the simulated external rack conditions,
 * the DCIM telemetry stream, scenario playback and the event bus.
 *
 * Time only moves through `advance(dt)`, so playback is deterministic and pausing is exact.
 * React reads `getSnapshot()` (immutable, changes only on events); the game loop reads live fields.
 */
import {
  BLOCKER_REASON,
  CFG,
  CLASS_NAME,
  RackSentinelController,
  SETTINGS_MASK,
  TEMP_CLASS,
  resetBlockers,
  settingsView,
  type ControllerState,
  type FrameResult,
  type ResetOutcome,
} from "./controller";
import { EventBus, type Notice, type NoticeTone, type SimEvents, type TelemetryKind } from "./events";
import { CMD, CMD_NAME, causeText, encodeCommand, hexBytes, INPUT } from "./protocol";
import { RecoveryCoordinator, type RecoveryPhase } from "./recovery";
import { SCENARIOS, type Scenario, type ScenarioStep } from "./scenarios";
import { RESET_ENTRY, digest, leakChain, resetChain, telemetryChain, telemetryEntries, type CauseChain, type TimelineEntry } from "./timeline";
import { ampsToRaw, degCToRaw, fmtAmps, fmtDegC, fmtKW } from "./units";

/** The rack as the DCIM measures it (raw sensor steps) plus the leak sensor. */
export interface RawConditions {
  tempRaw: number;
  currentRaw: number;
  leak: boolean;
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

export interface LastFrame {
  kind: TelemetryKind;
  outcome: FrameResult["outcome"];
  frame: number[];
  reply: number[];
  at: number;
}

export interface SimSnapshot {
  version: number;
  controller: ControllerState;
  conditions: RawConditions;
  streaming: boolean;
  lastSampleAt: number | null;
  p0Down: boolean;
  lastFrame: LastFrame | null;
  /** The last data reply (STATUS, ENERGY, COUNTERS, TRIP_INFO). */
  lastQuery: LastFrame | null;
  lastReset: { outcome: ResetOutcome; at: number } | null;
  resetBlockers: ResetOutcome[];
  scenario: { id: string; name: string; running: boolean; stage: ScenarioStage | null } | null;
  recovery: RecoveryPhase;
  paused: boolean;
  notices: Notice[];
  /** Meaningful events since the last restart, oldest first. */
  timeline: TimelineEntry[];
  /** The latest controller decision, for the causality ribbon. */
  chain: CauseChain | null;
}

export const STREAM_PERIOD_MS = 3000;
export const PRESS_HOLD_MS = 280;
/** Time between readings when the terminal walks toward a new value. */
export const RAMP_STEP_MS = 350;
/** Time after the last scripted step before a scenario with nothing pending is complete. */
export const SCENARIO_TAIL_MS = 1500;
/** Minimum spacing between alerts reaching the HUD, so a burst stays readable. */
export const ALERT_GAP_MS = 1200;
/** How long the "Scenario complete" line stays in the prompt bar. */
const COMPLETE_STAGE_MS = 7000;
/** Timeline entries kept per run. */
const TIMELINE_MAX = 160;

export const RESET_MESSAGES: Record<ResetOutcome, { title: string; detail?: string; tone: NoticeTone }> = {
  accepted: { title: "Reset accepted", detail: "Every cause is gone · power-off cleared", tone: "ok" },
  leak: { title: "Reset refused: leak sensor still wet", detail: "P1 must be dry first", tone: "alarm" },
  "temperature-critical": { title: "Reset refused: temperature is Critical", detail: "Temperature must be below the Critical threshold (35.0 °C)", tone: "alarm" },
  runaway: { title: "Reset refused: latest reading was a runaway", detail: "A new reading without the steep rise is needed", tone: "warn" },
  "config-fault": { title: "Reset refused: a setting is unreadable", detail: "The DCIM must rewrite the damaged setting", tone: "warn" },
  held: { title: "Reset refused: P0 was already held", detail: "Release P0 and press again", tone: "warn" },
  "not-latched": { title: "Nothing to reset", detail: "No power-off is latched", tone: "info" },
  released: { title: "P0 released", tone: "info" },
};

export const NORMAL: RawConditions = { tempRaw: 44, currentRaw: 100, leak: false }; // 22.0 °C, 20.0 A

/** Whether the controller would accept a new P0 press right now (ignoring the button level). */
export const canReset = (s: ControllerState) => s.epo && resetBlockers(s, false).length === 0;

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
  private rampToken = 0;
  private scenario: { def: Scenario; running: boolean; stepsDone: boolean; stage: ScenarioStage | null; recovering: boolean } | null = null;
  private lastFrame: LastFrame | null = null;
  private lastQuery: LastFrame | null = null;
  private lastReset: SimSnapshot["lastReset"] = null;
  private notices: Notice[] = [];
  private noticeSeq = 0;
  private nextNoticeAt = 0;
  private timeline: TimelineEntry[] = [];
  private chain: CauseChain | null = null;
  private recordSeq = 0;
  /** The packet being sent is a scripted external recovery reading. */
  private recoveryReading = false;
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
      lastQuery: this.lastQuery,
      lastReset: this.lastReset,
      resetBlockers: resetBlockers(c, this.p0Down),
      scenario: this.scenario
        ? { id: this.scenario.def.id, name: this.scenario.def.name, running: this.scenario.running, stage: this.scenario.stage }
        : null,
      recovery: this.recovery.phase,
      paused: this.paused,
      notices: this.notices,
      timeline: this.timeline,
      chain: this.chain,
    };
  }

  // ---------------------------------------------------------------- clock
  advance(dtMs: number): void {
    if (this.paused || dtMs <= 0) return;
    const end = this.time + Math.min(dtMs, 250);
    for (;;) {
      const nextTask = this.tasks.length ? this.tasks[0].at : Infinity;
      const nextStream = this.streaming ? this.nextStreamAt : Infinity;
      const next = Math.min(nextTask, nextStream);
      if (next > end) break;
      this.time = next;
      if (nextStream <= nextTask) this.transmitReadings();
      else this.tasks.shift()!.run();
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
    this.rampToken++;
    this.recovery.reset();
    this.agent?.cancel();
    this.controller.reset();
    this.conditions = { ...NORMAL };
    this.streaming = opts.streaming ?? true;
    this.nextStreamAt = this.time + 600;
    this.p0Down = false;
    this.lastSampleAt = null;
    this.lastFrame = null;
    this.lastQuery = null;
    this.lastReset = null;
    if (!opts.keepScenario) this.scenario = null;
    this.notices = [];
    this.nextNoticeAt = 0;
    this.timeline = [];
    this.chain = null;
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
    this.notify(def.name, def.moment, "info");
    this.setStage({ title: "Scenario started", detail: def.moment, tone: "info" });
    this.record({ kind: "scenario", title: `Scenario started · ${def.name}`, detail: `${def.testCase} · ${def.summary}`, tone: "info", focus: "room" });
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
      ? "Power-off still latched."
      : this.controller.state.epoTrips
        ? "Power-off cleared by a new P0 press. Monitoring resumed."
        : "No power-off was latched, so no reset was needed.";
    sc.stage = { title: "Scenario complete", detail, tone: epo ? "warn" : "ok" };
    sc.running = false;
    this.record({ kind: "scenario", title: "Scenario completed", detail, tone: epo ? "warn" : "ok", focus: "room" });
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
        this.setConditions({ amps: step.amps, degC: step.degC }, true);
        break;
      case "recover":
        this.externalRecovery(step);
        break;
      case "corrupt":
        // one DATA bit damaged on the wire: the CRC no longer matches
        this.sendFrame("corrupt", CMD.TEMP, degCToRaw(step.degC), 0x01);
        break;
      case "invalid":
        this.sendFrame("invalid", CMD.TEMP, 0);
        break;
      case "command":
        this.sendCommand(step.cmd, step.data);
        break;
      case "leak":
        this.setLeak(step.wet);
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
   * Simulated external recovery: the rack environment improves and the DCIM sends the new
   * reading. RackSentinel only measures it; P5 never changes a reading.
   */
  private externalRecovery(c: { amps: number; degC: number }): void {
    const sc = this.scenario?.running ? this.scenario : null;
    if (sc && !sc.recovering) this.notify("External rack conditions recovering", "Simulated environment change, sent as new DCIM readings.", "info");
    if (sc) sc.recovering = true;
    this.recoveryReading = true;
    try {
      this.setConditions({ amps: c.amps, degC: c.degC }, true);
    } finally {
      this.recoveryReading = false;
    }
    const s = this.controller.state;
    const blockers = resetBlockers(s, false);
    if (!s.epo) {
      this.setStage({ title: "External conditions recovered", detail: `${fmtDegC(s.latestTemp)} · ${fmtAmps(s.latestCurrent)}. Nothing latched.`, tone: "ok" });
    } else if (blockers.length) {
      this.setStage({ title: `Cooling · ${fmtDegC(s.latestTemp)} · reset still blocked`, detail: `Blocked because ${BLOCKER_REASON[blockers[0]]}.`, tone: "alarm" });
    } else {
      this.setStage({ title: `${fmtDegC(s.latestTemp)} · ${CLASS_NAME[s.tempClass]} · power-off still latched`, detail: "Safe to reset, but readings alone do not clear P7. A person must press P0.", tone: "warn" });
    }
  }

  // ---------------------------------------------------------------- telemetry (DCIM → controller)
  setConditions(c: { amps: number; degC: number }, sendNow: boolean): void {
    this.setRawConditions({ ...this.conditions, currentRaw: ampsToRaw(c.amps), tempRaw: degCToRaw(c.degC) }, sendNow);
  }

  setRawConditions(c: Partial<RawConditions>, sendNow: boolean): void {
    this.rampToken++;
    this.conditions = {
      tempRaw: clampByte(c.tempRaw ?? this.conditions.tempRaw),
      currentRaw: clampByte(c.currentRaw ?? this.conditions.currentRaw),
      leak: c.leak ?? this.conditions.leak,
    };
    if (sendNow) this.transmitReadings();
    else this.changed();
  }

  /**
   * Walk the readings toward a target one sensor step at a time, sending each step, like a room
   * that heats or cools gradually. Stops if the conditions are changed some other way.
   */
  rampTo(target: { tempRaw?: number; currentRaw?: number }, stepMs = RAMP_STEP_MS): void {
    const token = ++this.rampToken;
    const tick = () => {
      if (token !== this.rampToken) return;
      const c = this.conditions;
      const tT = target.tempRaw ?? c.tempRaw, tI = target.currentRaw ?? c.currentRaw;
      const tempRaw = c.tempRaw + Math.sign(tT - c.tempRaw);
      // current may move faster: up to 5 steps (1 A) per reading
      const currentRaw = c.currentRaw + Math.max(-5, Math.min(5, tI - c.currentRaw));
      this.conditions = { ...c, tempRaw, currentRaw };
      this.transmitReadings();
      this.rampToken = token; // transmitReadings does not change the token; keep walking
      if (tempRaw !== tT || currentRaw !== tI) this.schedule(stepMs, tick);
    };
    tick();
  }

  setStreaming(on: boolean): void {
    if (this.streaming === on) return;
    this.streaming = on;
    this.nextStreamAt = this.time + (on ? 400 : 0);
    this.record({ kind: "link", title: on ? "Telemetry link resumed" : "Telemetry link silent", detail: on ? undefined : "Controller holds its last state; P0 and P1 are still watched.", tone: on ? "info" : "warn", focus: "desk" });
    if (on) this.notify("Telemetry resumed", "The DCIM is sending readings again.", "info");
    else this.notify("Telemetry stopped", "Controller holds its last state. P0 and the leak sensor still work locally.", "warn");
    this.changed();
  }

  /** One DCIM reading cycle: a TEMP packet, then a CURRENT packet. */
  transmitReadings(): void {
    if (this.streaming) this.nextStreamAt = this.time + STREAM_PERIOD_MS;
    this.sendFrame("temp", CMD.TEMP, this.conditions.tempRaw);
    this.sendFrame("current", CMD.CURRENT, this.conditions.currentRaw);
  }

  /** A DCIM command: a setting, a query or the ECC self-test. */
  sendCommand(cmd: number, data: number): FrameResult {
    return this.sendFrame("command", cmd, data);
  }

  /** Send one 4-byte packet from the DCIM terminal and process the controller's reply. */
  sendFrame(kind: TelemetryKind, cmd: number, data: number, corruptData = 0): FrameResult {
    const frame = encodeCommand(cmd, data, corruptData);
    const before = this.controller.snapshot();
    const result = this.controller.receiveFrame(frame);
    const after = this.controller.snapshot();
    this.lastSampleAt = this.time;
    const lf: LastFrame = { kind, outcome: result.outcome, frame: result.frame, reply: result.reply, at: this.time };
    this.lastFrame = lf;
    if (result.outcome === "data") this.lastQuery = lf;
    if (!this.quiet) {
      this.bus.emit("telemetry", { kind, result });
      for (const e of telemetryEntries(kind, result, before, after, this.recoveryReading)) this.record(e);
      const nodes = telemetryChain(kind, result, before, after);
      if (nodes) this.setChain("telemetry", nodes, before, after);
    }
    this.describeTransition(before, after, result);
    this.bus.emit("state", after);
    this.changed();
    return result;
  }

  // ---------------------------------------------------------------- the leak sensor (P1)
  setLeak(wet: boolean): void {
    if (this.conditions.leak === wet && !!(this.controller.state.inputs & INPUT.LEAK) === wet) return;
    this.conditions = { ...this.conditions, leak: wet };
    const before = this.controller.snapshot();
    const r = this.controller.setLeak(wet);
    const after = this.controller.snapshot();
    if (!this.quiet) {
      this.bus.emit("leak", { wet });
      this.record({ kind: "leak", title: wet ? "P1 leak sensor wet" : "P1 leak sensor dry", tone: wet ? "alarm" : "info", focus: "rack" });
      if (r.leakTrip) {
        this.bus.emit("trip", { cause: 0x04 });
        this.record({ kind: "epo", title: "P7 power-off latched", detail: `Cause: water leak. Trip ${after.epoTrips}. No UART message needed.`, tone: "alarm", focus: "rack" });
      }
      const nodes = leakChain(wet, r.leakTrip, after);
      if (nodes) this.setChain("leak", nodes, before, after);
    }
    if (r.leakTrip) {
      this.notify("Water leak · power-off latched", "P1 is wet. The chip cut power by itself, with no message on the link.", "alarm");
      this.setStage({ title: "Water on P1 · power-off latched", detail: "Reset is refused while the sensor is wet.", tone: "alarm" });
    } else if (wet) {
      this.notify("Leak sensor wet", "Power-off already latched. Reset is refused while P1 is wet.", "warn");
    } else {
      this.notify("Leak sensor dry", after.epo ? "Power-off stays latched until a person presses P0." : "Nothing latched.", after.epo ? "warn" : "info");
    }
    this.bus.emit("state", after);
    this.changed();
  }

  private describeTransition(b: ControllerState, a: ControllerState, r: FrameResult): void {
    if (r.outcome === "invalid") {
      this.notify("Rejected (3C)", r.notes.at(-1)?.text ?? "Invalid command or value. Nothing changed.", "warn");
      return;
    }
    if (r.outcome === "bad-crc") {
      this.notify("Damaged packet rejected (5A)", "Bad CRC. Nothing was acted on; the reject counter went up.", "warn");
      return;
    }
    if (r.outcome === "data") {
      this.notify(`${CMD_NAME[r.command]} reply`, hexBytes(r.reply), "info");
      return;
    }
    if (r.command === CMD.FLIP_TEST) {
      this.notify("ECC self-test", r.notes.at(-1)?.text ?? "Bits flipped in memory.", "warn");
      return;
    }
    if (r.command !== CMD.TEMP && r.command !== CMD.CURRENT) {
      this.notify(`${CMD_NAME[r.command] ?? "Command"} accepted`, r.notes.at(-1)?.text, "info");
      return;
    }

    if (a.eccCorrected > b.eccCorrected) {
      if (!this.quiet) this.bus.emit("warning", { what: "ecc" });
      this.notify("Memory error corrected", "One flipped bit in a setting was repaired at its next use and written back.", "ok");
    }
    if (!b.epo && a.epo) {
      const cause = settingsView(a)[CFG.TRIP_CAUSE].value;
      if (!this.quiet) this.bus.emit("trip", { cause });
      this.notify("Power-off latched", `P7 on: ${causeText(cause)}. Safe readings alone will not clear it.`, "alarm");
      this.setStage({ title: `Power-off latched · ${causeText(cause)}`, detail: "The trip record saves the cause, temperature and current.", tone: "alarm" });
      return;
    }
    if ((a.fault & SETTINGS_MASK) && !(b.fault & SETTINGS_MASK)) {
      this.notify("Setting unreadable", "Two flipped bits. The chip fails safe until the DCIM rewrites the setting.", "alarm");
    }
    if (a.rapid && !b.rapid && a.epo) {
      if (!this.quiet) this.bus.emit("warning", { what: "runaway" });
      this.notify("Thermal runaway", `A rise of ${fmtDegC(a.latestTemp - b.latestTemp)} in one reading. Reset blocked until the rise stops.`, "warn");
    }
    if (a.tempClass !== b.tempClass && r.command === CMD.TEMP) {
      const t = fmtDegC(a.latestTemp);
      if (a.tempClass === TEMP_CLASS.WARM) {
        if (!this.quiet && b.tempClass === TEMP_CLASS.NORMAL) this.bus.emit("warning", { what: "warm" });
        this.notify(`Rack Warm · ${t}`, a.epo ? "P4 fan boost. Power-off remains latched." : "P4 fan boost requested.", "warn");
      } else if (a.tempClass === TEMP_CLASS.HOT) {
        if (!this.quiet && b.tempClass < TEMP_CLASS.HOT) this.bus.emit("warning", { what: "hot" });
        this.notify(`Rack Hot · ${t}`, a.epo ? "P5 fans at maximum. Power-off remains latched." : "P5 fans at maximum. No power-off below Critical.", "warn");
      } else if (a.tempClass === TEMP_CLASS.CRITICAL) {
        this.notify(`Temperature Critical · ${t}`, "Power-off remains latched.", "alarm");
      } else {
        this.notify(`Temperature Normal · ${t}`, a.epo ? "Fans normal. Power-off remains latched." : "Fans normal.", "info");
      }
    }
    if (a.overload !== b.overload && r.command === CMD.CURRENT) {
      if (a.overload) {
        if (!this.quiet) this.bus.emit("warning", { what: "overload" });
        this.notify(`Power overload · ${fmtKW(a.power ?? 0)}`, "P6 alarm: at or above the power limit. A warning, not a power-off.", "warn");
      } else {
        this.notify(`Power below the limit · ${fmtKW(a.power ?? 0)}`, "P6 alarm off.", "info");
      }
    }
    if (a.epo && canReset(a) && !canReset(b) && r.command === CMD.TEMP) {
      if (this.p0Down) this.notify(RESET_MESSAGES.held.title, `Safe to reset. ${RESET_MESSAGES.held.detail}.`, "warn");
      else this.notify("Safe to reset · power-off remains latched", "Operator acknowledgement required: a new P0 press at the rack.", "warn");
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
    const before = this.controller.snapshot();
    const poll = this.controller.setP0(true);
    if (!this.quiet) this.bus.emit("button", { down: true });
    if (fromOperator) this.recovery.onOperatorPress();
    if (poll.reset && (!wasDown || poll.newPress)) this.recordReset(poll.reset, before, fromOperator);
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

  private recordReset(outcome: ResetOutcome, before: ControllerState, fromOperator = false): void {
    this.lastReset = { outcome, at: this.time };
    const s = this.controller.state;
    const holdOpen = outcome === "not-latched" && this.scenario?.def.id === "held-button";
    if (!this.quiet) {
      this.bus.emit("reset", { outcome });
      const e = RESET_ENTRY[outcome];
      if (e && !holdOpen) this.record({ kind: "reset", title: e.title, tone: e.tone, focus: "button", reset: outcome });
      const nodes = resetChain(outcome, s);
      if (nodes) this.setChain("reset", nodes, before, s);
    }
    if (holdOpen) {
      this.notify("P0 held down", "The reset button is stuck in the pressed position.", "info");
      this.setStage({ title: "P0 held down", detail: "The reset button is stuck in the pressed position.", tone: "info" });
      return;
    }
    const m = RESET_MESSAGES[outcome];
    this.notify(m.title, m.detail, m.tone);
    if (outcome !== "accepted" && outcome !== "not-latched") this.setStage({ title: m.title, detail: m.detail, tone: m.tone });
    this.recovery.onReset(outcome, fromOperator);
  }

  // ---------------------------------------------------------------- incident record
  private record(e: Omit<TimelineEntry, "id" | "at" | "values">): void {
    if (this.quiet) return;
    const entry: TimelineEntry = { ...e, id: ++this.recordSeq, at: this.time, values: digest(this.controller.state, this.p0Down) };
    this.timeline = [...this.timeline.slice(-(TIMELINE_MAX - 1)), entry];
  }

  private setChain(kind: CauseChain["kind"], nodes: CauseChain["nodes"], before: ControllerState, after: ControllerState): void {
    this.chain = { id: ++this.recordSeq, at: this.time, kind, nodes, before: digest(before, this.p0Down), after: digest(after, this.p0Down) };
  }

  // ---------------------------------------------------------------- notices
  /**
   * Raise an alert. Alerts are released at least ALERT_GAP_MS apart on the simulation clock so
   * each is readable; `at` stays the moment the event happened.
   */
  notify(title: string, detail: string | undefined, tone: NoticeTone): void {
    if (this.quiet) return;
    const at = this.time;
    const due = Math.max(this.time, this.nextNoticeAt);
    this.nextNoticeAt = due + ALERT_GAP_MS;
    if (due === this.time) this.pushNotice(title, detail, tone, at);
    else this.schedule(due - this.time, () => this.pushNotice(title, detail, tone, at));
  }

  private pushNotice(title: string, detail: string | undefined, tone: NoticeTone, at: number): void {
    const n: Notice = { id: ++this.noticeSeq, title, detail, tone, at };
    this.notices = [...this.notices.slice(-9), n];
    this.bus.emit("notice", n);
    this.changed();
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
