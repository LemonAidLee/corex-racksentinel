import { describe, expect, it } from "vitest";
import { TEMP_CLASS, type ResetOutcome } from "./controller";
import { ALERT_GAP_MS, SimulationRuntime, type OperatorAgent } from "./runtime";
import { SCENARIOS, needsAcknowledge, scenarioById } from "./scenarios";
import { DEMO_BEATS, GuidedDemo } from "./demo";

function run(rt: SimulationRuntime, ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) rt.advance(step);
}

function play(id: string, ms = 45000) {
  const rt = new SimulationRuntime();
  rt.playScenario(id);
  run(rt, ms);
  return rt;
}

/** Advance until simulation time reaches `at` (ms since the runtime was created). */
function until(rt: SimulationRuntime, at: number, step = 16) {
  while (rt.time < at) rt.advance(Math.min(step, at - rt.time));
}

/**
 * Stand-in for the scene's operator: walks for `walkMs`, then presses P0 through the same
 * buttonDown(true) / buttonUp() calls as the real one. Records every request.
 */
class FakeOperator implements OperatorAgent {
  pressCalls: { at: number; auto: boolean; safe: boolean; epo: boolean; held: boolean }[] = [];
  presses = 0;
  cancels = 0;
  returns = 0;
  busy = false;
  private trip = 0;
  private fingerDown = false;
  constructor(private rt: SimulationRuntime, private walkMs = 1500) {}

  pressReset(): void {
    const s = this.rt.controller.state;
    this.pressCalls.push({
      at: this.rt.time,
      auto: this.rt.recovery.phase === "dispatched",
      safe: s.tempClass === TEMP_CLASS.NORMAL && s.latestCurrent < s.warnCurrent,
      epo: s.epo,
      held: this.rt.p0Down,
    });
    const trip = ++this.trip;
    this.busy = true;
    this.rt.schedule(this.walkMs, () => {
      if (trip !== this.trip) return;
      if (this.rt.p0Down) this.rt.buttonUp(); // unstick a held button first, like the real operator
      this.fingerDown = true;
      this.presses++;
      this.rt.buttonDown(true);
      this.rt.schedule(280, () => {
        if (trip !== this.trip) return;
        this.fingerDown = false;
        this.rt.buttonUp();
        this.busy = false;
      });
    });
  }

  cancel(): void {
    this.cancels++;
    this.trip++;
    if (this.fingerDown) this.rt.buttonUp();
    this.fingerDown = false;
    this.busy = false;
  }

  returnToDesk(): void {
    this.returns++;
  }
}

/** Record every reset outcome and check that the EPO only ever clears on an accepted P0 press. */
function watch(rt: SimulationRuntime) {
  const outcomes: { outcome: ResetOutcome; at: number }[] = [];
  const clears: { at: number; viaPress: boolean }[] = [];
  let epo = rt.controller.state.epo;
  rt.bus.on("reset", ({ outcome }) => outcomes.push({ outcome, at: rt.time }));
  rt.bus.on("state", (s) => {
    if (epo && !s.epo) {
      const r = rt.getSnapshot().lastReset;
      clears.push({ at: rt.time, viaPress: rt.p0Down && r?.outcome === "accepted" && r.at === rt.time });
    }
    epo = s.epo;
  });
  rt.bus.on("restart", () => (epo = false));
  return { outcomes, clears, refused: () => outcomes.filter((o) => !["accepted", "not-latched", "released"].includes(o.outcome)) };
}

function withOperator(id: string, walkMs = 1500) {
  const rt = new SimulationRuntime();
  const op = new FakeOperator(rt, walkMs);
  rt.agent = op;
  const w = watch(rt);
  rt.playScenario(id);
  return { rt, op, w };
}

const ACK_IDS = SCENARIOS.filter(needsAcknowledge).map((s) => s.id);
const NO_ACK_IDS = ["normal", "warm", "current-warning"];

describe("scenario playback ends in the documented state (headless)", () => {
  const expected: Record<string, { pins: number; trips: number }> = {
    normal: { pins: 0x00, trips: 0 },
    warm: { pins: 0x00, trips: 0 },
    "critical-heat": { pins: 0x00, trips: 1 },
    "current-warning": { pins: 0x00, trips: 0 },
    "current-trip": { pins: 0x00, trips: 1 },
    combined: { pins: 0x00, trips: 1 },
    recover: { pins: 0x00, trips: 1 },
    "reset-warm": { pins: 0x00, trips: 1 },
    "reset-current": { pins: 0x00, trips: 1 },
    "held-button": { pins: 0x00, trips: 1 },
    invalid: { pins: 0x00, trips: 1 },
    corrupt: { pins: 0x00, trips: 1 },
    "no-telemetry": { pins: 0x00, trips: 1 },
  };

  it("covers every scenario", () => {
    expect(Object.keys(expected).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    expect([...ACK_IDS, ...NO_ACK_IDS].sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  for (const [id, want] of Object.entries(expected)) {
    it(`${id}: final outputs, trips, and the scenario completes`, () => {
      const rt = play(id);
      expect(rt.controller.pins).toBe(want.pins);
      expect(rt.controller.state.epoTrips).toBe(want.trips);
      const sc = rt.getSnapshot().scenario!;
      expect(sc.running).toBe(false);
      expect(rt.recovery.phase === "idle" || rt.recovery.phase === "done").toBe(true);
    });
  }

  it("spaces alerts far enough apart to read", () => {
    for (const s of SCENARIOS) {
      const rt = new SimulationRuntime();
      const shownAt: number[] = [];
      rt.bus.on("notice", () => shownAt.push(rt.time));
      rt.playScenario(s.id);
      run(rt, 45000);
      expect(shownAt.length, s.id).toBeGreaterThan(0);
      for (let i = 1; i < shownAt.length; i++) {
        expect(shownAt[i] - shownAt[i - 1], `${s.id} alert ${i}`).toBeGreaterThanOrEqual(ALERT_GAP_MS);
      }
    }
  });

  it("is deterministic", () => {
    for (const s of SCENARIOS) expect(play(s.id).getSnapshot().controller).toEqual(play(s.id).getSnapshot().controller);
  });

  it("pausing freezes playback", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("critical-heat");
    rt.setPaused(true);
    run(rt, 10000);
    expect(rt.controller.state.epo).toBe(false);
  });
});

describe("external recovery and operator acknowledgement", () => {
  it("Critical Heat: P5 requests maximum fan but the reading only changes with new external telemetry", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("critical-heat");
    until(rt, 3100);
    expect(rt.controller.pins).toBe(0xa0); // P5 + P7
    expect(rt.controller.state.latestTemp).toBe(65); // 32.5 °C
    until(rt, 6900); // streamed samples repeat the same external reading while P5 is on
    expect(rt.controller.state.latestTemp).toBe(65);
    until(rt, 7100);
    expect(rt.controller.state.latestTemp).toBe(64); // 32.0 °C: external recovery, still Warm
    expect(rt.controller.state.tempClass).toBe(TEMP_CLASS.WARM);
    expect(rt.controller.state.epo).toBe(true);
    until(rt, 10400); // part way down the gradual recovery: cooler, but not yet Normal
    expect(rt.controller.state.latestTemp).toBeGreaterThan(53);
    expect(rt.controller.state.latestTemp).toBeLessThan(64);
    until(rt, 14300);
    expect(rt.controller.state.latestTemp).toBe(53); // 26.5 °C safe telemetry
    expect(rt.controller.state.tempClass).toBe(TEMP_CLASS.NORMAL);
  });

  it("Critical Heat cools one 0.5 °C step at a time, never jumping to the safe reading", () => {
    const rt = new SimulationRuntime();
    const temps: number[] = [];
    rt.bus.on("state", (s) => {
      if (s.gotTemp && temps[temps.length - 1] !== s.latestTemp) temps.push(s.latestTemp);
    });
    rt.playScenario("critical-heat");
    run(rt, 30000);
    const falls = temps.slice(1).map((t, i) => temps[i] - t).filter((d) => d > 0);
    expect(falls).toHaveLength(12); // 32.5 °C down to 26.5 °C
    expect(Math.max(...falls)).toBe(1); // one raw step is 0.5 °C: no jumps
    expect(temps[temps.length - 1]).toBe(53);
  });

  it("EPO stays latched after safe telemetry until the operator's new P0 press", () => {
    const { rt, w } = withOperator("critical-heat");
    until(rt, 15900); // safe since 14.2 s, dwell not over
    expect(rt.controller.state.epo).toBe(true);
    expect(rt.getSnapshot().resetBlockers).toEqual([]);
    expect(w.outcomes).toEqual([]);
    expect(rt.getSnapshot().scenario?.stage?.title).toMatch(/Safe telemetry received/);
    run(rt, 6000);
    expect(rt.controller.state.epo).toBe(false);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["accepted"]);
    expect(w.clears).toEqual([{ at: expect.any(Number), viaPress: true }]);
  });

  it("the operator is only sent when a reset is appropriate, and never clears the EPO directly", () => {
    for (const id of ACK_IDS) {
      const { rt, op, w } = withOperator(id);
      run(rt, 48000);
      const auto = op.pressCalls.filter((c) => c.auto);
      expect(auto.length, id).toBe(1);
      for (const c of auto) expect(c, id).toMatchObject({ safe: true, epo: true, held: false });
      expect(rt.controller.state.epo, id).toBe(false);
      expect(w.clears.length, id).toBe(1);
      expect(w.clears.every((c) => c.viaPress), id).toBe(true);
      // the accepted press came from the operator's finger
      expect(op.presses, id).toBe(op.pressCalls.length);
      expect(op.returns, id).toBeGreaterThan(0);
    }
  });

  for (const id of NO_ACK_IDS) {
    it(`${scenarioById(id)!.name}: no EPO, so the operator never presses P0`, () => {
      const { rt, op, w } = withOperator(id);
      run(rt, 30000);
      expect(op.pressCalls).toEqual([]);
      expect(w.outcomes).toEqual([]);
      expect(rt.recovery.phase).toBe("idle");
      expect(rt.getSnapshot().scenario?.running).toBe(false);
    });
  }

  it("Current Trip: reset stays blocked at exactly 32.0 A, then succeeds at 25.4 A", () => {
    const { rt, w } = withOperator("current-trip");
    until(rt, 7200);
    expect(rt.controller.state.latestCurrent).toBe(160); // 32.0 A: warning, no longer a trip
    expect(rt.controller.state.epo).toBe(true);
    expect(rt.getSnapshot().resetBlockers).toEqual(["current-warning"]);
    expect(rt.recovery.phase).toBe("idle"); // not in the acknowledgement phase yet
    rt.pressReset(false); // a user press while unsafe is refused normally
    expect(rt.getSnapshot().lastReset?.outcome).toBe("current-warning");
    rt.buttonUp();
    until(rt, 14300);
    expect(rt.controller.state.latestCurrent).toBe(127); // 25.4 A
    expect(rt.controller.state.epo).toBe(true);
    run(rt, 6000);
    expect(rt.controller.state.epo).toBe(false);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["current-warning", "accepted"]);
  });

  it("Reset While Warm: one refused press, then one later accepted press", () => {
    const { rt, op, w } = withOperator("reset-warm");
    run(rt, 40000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["temperature-warm", "accepted"]);
    expect(op.pressCalls.map((c) => c.auto)).toEqual([false, true]);
    expect(w.outcomes[1].at).toBeGreaterThan(12500 + 2000);
  });

  it("Reset During Current Warning: one refused press, then one later accepted press", () => {
    const { rt, op, w } = withOperator("reset-current");
    run(rt, 40000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["current-warning", "accepted"]);
    expect(op.pressCalls.map((c) => c.auto)).toEqual([false, true]);
  });

  it("Held Reset Button: safe readings and the hold cannot clear; release, then a new press", () => {
    const { rt, op, w } = withOperator("held-button");
    until(rt, 11600);
    expect(rt.p0Down).toBe(true);
    expect(rt.controller.state.epo).toBe(true);
    expect(rt.getSnapshot().resetBlockers).toEqual(["held"]);
    expect(op.pressCalls).toEqual([]);
    until(rt, 14100);
    expect(rt.p0Down).toBe(false); // released by the script, not by a reset
    expect(rt.controller.state.epo).toBe(true);
    run(rt, 10000);
    expect(rt.controller.state.epo).toBe(false);
    const accepted = w.outcomes.filter((o) => o.outcome === "accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].at).toBeGreaterThanOrEqual(15000);
    expect(op.pressCalls).toHaveLength(1);
    expect(op.pressCalls[0]).toMatchObject({ auto: true, held: false });
  });

  it("Invalid Telemetry: 0x3C leaves readings and outputs unchanged before a later valid recovery", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("invalid");
    until(rt, 3900);
    const before = rt.controller.snapshot();
    until(rt, 4050);
    expect(rt.getSnapshot().lastFrame).toMatchObject({ kind: "invalid", reply: [0x3c] });
    expect(rt.controller.snapshot()).toEqual(before);
    until(rt, 12100);
    expect(rt.controller.state).toMatchObject({ epo: true, tempClass: TEMP_CLASS.NORMAL });
    run(rt, 12000);
    expect(rt.controller.pins).toBe(0);
  });

  it("Corrupted Message: 0x5A cannot change or clear the state before a later valid recovery", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("corrupt");
    until(rt, 3900);
    const before = rt.controller.snapshot();
    until(rt, 4050);
    expect(rt.getSnapshot().lastFrame).toMatchObject({ kind: "corrupt", reply: [0x5a] });
    expect(rt.controller.snapshot()).toEqual({ ...before, crcRejects: 1 });
    expect(rt.controller.state.epo).toBe(true);
    until(rt, 12100);
    expect(rt.controller.state).toMatchObject({ epo: true, tempClass: TEMP_CLASS.NORMAL, latestTemp: 53 });
    run(rt, 12000);
    expect(rt.controller.pins).toBe(0);
  });

  it("No Telemetry: the link stays silent and P0 still resets locally", () => {
    const { rt, w } = withOperator("no-telemetry");
    until(rt, 11600);
    const at = rt.lastSampleAt;
    expect(rt.streaming).toBe(false);
    run(rt, 20000);
    expect(rt.lastSampleAt).toBe(at);
    expect(rt.streaming).toBe(false);
    expect(rt.controller.state.epo).toBe(false);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["accepted"]);
    expect(w.outcomes[0].at).toBeGreaterThan(5500);
  });
});

describe("cancellation and manual interaction", () => {
  it("starting a new scenario cancels a pending automatic reset", () => {
    const { rt, op, w } = withOperator("critical-heat", 3000);
    until(rt, 16400); // operator dispatched at 16.2 s and still walking
    expect(rt.recovery.phase).toBe("dispatched");
    expect(op.busy).toBe(true);
    rt.playScenario("normal");
    expect(op.cancels).toBeGreaterThan(0);
    expect(rt.recovery.phase).toBe("idle");
    run(rt, 30000);
    expect(op.presses).toBe(0);
    expect(w.outcomes).toEqual([]);
    expect(rt.controller.state.epoTrips).toBe(0);
  });

  it("restart releases P0 and cancels every pending step and action", () => {
    const { rt, op, w } = withOperator("held-button");
    until(rt, 3000);
    expect(rt.p0Down).toBe(true);
    rt.restart();
    expect(rt.p0Down).toBe(false);
    expect(rt.controller.state.btnPrev).toBe(false);
    expect(rt.controller.state.epo).toBe(false);
    expect(rt.recovery.phase).toBe("idle");
    expect(op.cancels).toBeGreaterThan(0);
    run(rt, 30000);
    expect(rt.controller.state.epoTrips).toBe(0);
    expect(rt.controller.state.latestCurrent).toBe(127); // only the normal stream
    expect(op.pressCalls).toEqual([]);
    expect(w.outcomes.filter((o) => o.at > 3000)).toEqual([]);
  });

  it("restart during the operator's press lets go of P0", () => {
    const { rt, op } = withOperator("critical-heat", 400);
    until(rt, 16200 + 400 + 150); // finger on the button
    expect(op.presses).toBe(1);
    rt.restart();
    expect(rt.p0Down).toBe(false);
    run(rt, 2000);
    expect(rt.p0Down).toBe(false);
  });

  it("a manual reset during the safe dwell means the operator is never sent", () => {
    const { rt, op, w } = withOperator("critical-heat");
    until(rt, 15000); // readings are safe, the operator has not been sent yet
    rt.pressReset(false); // the user presses P0 first
    expect(rt.controller.state.epo).toBe(false);
    run(rt, 20000);
    expect(op.pressCalls).toEqual([]);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["accepted"]);
    expect(rt.getSnapshot().scenario?.running).toBe(false);
  });

  it("a manual reset while the operator is on the way calls the operator off", () => {
    const { rt, op, w } = withOperator("critical-heat", 3000);
    until(rt, 16400);
    expect(rt.recovery.phase).toBe("dispatched");
    rt.pressReset(false);
    expect(rt.controller.state.epo).toBe(false);
    expect(op.cancels).toBeGreaterThan(0);
    run(rt, 20000);
    expect(op.presses).toBe(0);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["accepted"]);
  });

  it("an unsafe manual press is refused and the operator acknowledges later", () => {
    const { rt, op, w } = withOperator("critical-heat");
    until(rt, 7200); // 32.0 °C, still Warm
    rt.pressReset(false);
    run(rt, 400);
    expect(rt.controller.state.epo).toBe(true);
    run(rt, 25000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["temperature-warm", "accepted"]);
    expect(op.pressCalls.filter((c) => c.auto)).toHaveLength(1);
  });
});

describe("guided demo", () => {
  it("plays every beat to a cleared EPO with two trips", () => {
    const rt = new SimulationRuntime();
    const demo = new GuidedDemo(rt);
    demo.start();
    for (let i = 1; i < DEMO_BEATS.length; i++) {
      run(rt, 3000);
      demo.next();
    }
    run(rt, 5000);
    expect(rt.controller.pins).toBe(0);
    expect(rt.controller.state.epoTrips).toBe(2);
    expect(rt.controller.state.crcRejects).toBe(1);
  });

  it("rebuilds any beat instantly when stepping back", () => {
    const rt = new SimulationRuntime();
    const demo = new GuidedDemo(rt);
    demo.goTo(5); // safe readings, still latched, after a refused reset
    expect(rt.controller.pins).toBe(0x80);
    demo.goTo(6);
    expect(rt.controller.pins).toBe(0x00);
    demo.goTo(2);
    expect(rt.controller.pins).toBe(0xa0);
  });
});
