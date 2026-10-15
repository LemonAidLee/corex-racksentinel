import { describe, expect, it } from "vitest";
import { TEMP_CLASS, type ResetOutcome } from "./controller";
import { ALERT_GAP_MS, SimulationRuntime, type OperatorAgent } from "./runtime";
import { SCENARIOS, needsAcknowledge, scenarioById } from "./scenarios";
import { DEMO_BEATS, GuidedDemo } from "./demo";
import { CMD, encodeCommand } from "./protocol";
import { degCToRaw } from "./units";

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
  pressCalls: { at: number; auto: boolean; epo: boolean; held: boolean }[] = [];
  presses = 0;
  cancels = 0;
  returns = 0;
  busy = false;
  private trip = 0;
  private fingerDown = false;
  constructor(private rt: SimulationRuntime, private walkMs = 1500) {}

  pressReset(): void {
    this.pressCalls.push({ at: this.rt.time, auto: this.rt.recovery.phase === "dispatched", epo: this.rt.controller.state.epo, held: this.rt.p0Down });
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

/** Record every reset outcome and check that the power-off only ever clears on an accepted P0 press. */
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
  return { outcomes, clears };
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
const NO_ACK_IDS = ["normal", "heat-up", "overload", "energy", "invalid"];

describe("scenario playback ends in the documented state (headless)", () => {
  const expected: Record<string, { pins: number; trips: number }> = {
    normal: { pins: 0x00, trips: 0 },
    "heat-up": { pins: 0x00, trips: 0 },
    critical: { pins: 0x10, trips: 1 }, // reset accepted at 30.0 °C, still Warm
    runaway: { pins: 0x10, trips: 1 },
    leak: { pins: 0x00, trips: 1 },
    overload: { pins: 0x00, trips: 0 },
    energy: { pins: 0x00, trips: 0 },
    "ecc-one": { pins: 0x10, trips: 1 },
    "ecc-two": { pins: 0x00, trips: 1 },
    "held-button": { pins: 0x10, trips: 1 },
    corrupt: { pins: 0x10, trips: 1 },
    invalid: { pins: 0x00, trips: 0 },
    "silent-leak": { pins: 0x00, trips: 1 },
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
      expect(rt.getSnapshot().scenario!.running).toBe(false);
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
      for (let i = 1; i < shownAt.length; i++) expect(shownAt[i] - shownAt[i - 1], `${s.id} alert ${i}`).toBeGreaterThanOrEqual(ALERT_GAP_MS);
    }
  });

  it("is deterministic", () => {
    for (const s of SCENARIOS) expect(play(s.id).getSnapshot().controller).toEqual(play(s.id).getSnapshot().controller);
  });

  it("pausing freezes playback", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("critical");
    rt.setPaused(true);
    run(rt, 10000);
    expect(rt.controller.state.epo).toBe(false);
  });

  it("temperature only ever climbs one 0.5 °C step at a time, except in the cooling-failure scenario", () => {
    for (const s of SCENARIOS.filter((x) => x.id !== "runaway")) {
      const rt = new SimulationRuntime();
      let last = 0;
      let maxRise = 0;
      rt.bus.on("state", (st) => {
        if (st.gotTemp && last) maxRise = Math.max(maxRise, st.latestTemp - last);
        if (st.gotTemp) last = st.latestTemp;
      });
      rt.playScenario(s.id);
      run(rt, 45000);
      expect(maxRise, s.id).toBeLessThanOrEqual(1);
      expect(rt.controller.state.rapid, s.id).toBe(false);
    }
  });
});

describe("the rehearsed runs, as scenarios", () => {
  it("Morning check: STATUS answers 40 2C 64 00 as on the FPGA", () => {
    const rt = play("normal", 6000);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x40, 0x2c, 0x64, 0x00]);
  });

  it("Afternoon heat: Warm from 27.0 °C, Hot from 32.0 °C, never a power-off", () => {
    const rt = new SimulationRuntime();
    const seen = new Map<number, number>();
    rt.bus.on("state", (s) => s.gotTemp && seen.set(s.latestTemp, s.pins));
    rt.playScenario("heat-up");
    run(rt, 30000);
    expect(seen.get(53)).toBe(0x00);
    expect(seen.get(54)).toBe(0x10);
    expect(seen.get(63)).toBe(0x10);
    expect(seen.get(64)).toBe(0x20);
    expect(rt.controller.state.epoTrips).toBe(0);
  });

  it("Overheat: refused while Critical, accepted below Critical, trip record kept", () => {
    const { rt, op, w } = withOperator("critical");
    run(rt, 45000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["temperature-critical", "accepted"]);
    expect(op.pressCalls.map((c) => c.auto)).toEqual([false, true]);
    expect(rt.controller.state.tempClass).toBe(TEMP_CLASS.WARM);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x01, 0x46, 0x64, 0x01]);
    expect(w.clears).toEqual([{ at: expect.any(Number), viaPress: true }]);
  });

  it("Cooling failure: trips on +2.5 °C while Normal; reset blocked until the rise stops", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("runaway");
    until(rt, 3550);
    expect(rt.controller.state).toMatchObject({ epo: true, rapid: true, tempClass: TEMP_CLASS.NORMAL });
    expect(rt.getSnapshot().resetBlockers).toEqual(["runaway"]);
    run(rt, 30000);
    expect(rt.controller.state.epo).toBe(false);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x02, 0x35, 0x64, 0x01]);
  });

  it("Water leak: power-off with no packet, refused while wet, accepted once dry", () => {
    const { rt, w } = withOperator("leak");
    until(rt, 2400);
    const frames = rt.getSnapshot().lastSampleAt;
    until(rt, 2550);
    expect(rt.controller.state.epo).toBe(true);
    expect(rt.getSnapshot().lastSampleAt).toBe(frames); // no UART traffic caused it
    run(rt, 40000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["leak", "accepted"]);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x04, 0x2c, 0x64, 0x01]);
  });

  it("New server: overload follows the reading and the voltage setting, and never latches", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("overload");
    until(rt, 2600);
    expect(rt.controller.pins).toBe(0x40);
    until(rt, 5600);
    expect(rt.controller.pins).toBe(0x00);
    until(rt, 10600);
    expect(rt.controller.pins).toBe(0x40); // 25 A at 240 V
    until(rt, 13600);
    expect(rt.controller.pins).toBe(0x00);
    expect(rt.controller.state.epoTrips).toBe(0);
  });

  it("Energy report: 230 Wh as in R7", () => {
    const rt = play("energy", 8000);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0xe6, 0x00, 0x00, 0x00]);
  });

  it("One bit flips: corrected once; Critical still acts at exactly 35.0 °C", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("ecc-one");
    until(rt, 2600);
    expect(rt.controller.state).toMatchObject({ tempClass: TEMP_CLASS.HOT, eccCorrected: 1, epo: false });
    until(rt, 5600);
    expect(rt.controller.state).toMatchObject({ tempClass: TEMP_CLASS.CRITICAL, epo: true });
    until(rt, 8100);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("Two bits flip: power-off on a normal reading, refused until rewritten", () => {
    const { rt, w } = withOperator("ecc-two");
    until(rt, 2600);
    expect(rt.controller.state).toMatchObject({ epo: true, eccUncorrectable: 1, tempClass: TEMP_CLASS.NORMAL });
    run(rt, 40000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["config-fault", "accepted"]);
    expect(rt.getSnapshot().lastQuery?.reply).toEqual([0x08, 0x2c, 0x00, 0x01]);
  });
});

describe("external recovery and operator acknowledgement", () => {
  it("the operator is only sent when a reset would be accepted, and never clears the latch directly", () => {
    for (const id of ACK_IDS) {
      const { rt, op, w } = withOperator(id);
      run(rt, 48000);
      const auto = op.pressCalls.filter((c) => c.auto);
      expect(auto.length, id).toBe(1);
      for (const c of auto) expect(c, id).toMatchObject({ epo: true, held: false });
      expect(rt.controller.state.epo, id).toBe(false);
      expect(w.clears.length, id).toBe(1);
      expect(w.clears.every((c) => c.viaPress), id).toBe(true);
      expect(op.presses, id).toBe(op.pressCalls.length);
      expect(op.returns, id).toBeGreaterThan(0);
    }
  });

  for (const id of NO_ACK_IDS) {
    it(`${scenarioById(id)!.name}: nothing latched, so the operator never presses P0`, () => {
      const { rt, op, w } = withOperator(id);
      run(rt, 30000);
      expect(op.pressCalls).toEqual([]);
      expect(w.outcomes).toEqual([]);
      expect(rt.recovery.phase).toBe("idle");
      expect(rt.getSnapshot().scenario?.running).toBe(false);
    });
  }

  it("Overheat cools one 0.5 °C step at a time", () => {
    const rt = new SimulationRuntime();
    const temps: number[] = [];
    rt.bus.on("state", (s) => {
      if (s.gotTemp && temps[temps.length - 1] !== s.latestTemp) temps.push(s.latestTemp);
    });
    rt.playScenario("critical");
    run(rt, 30000);
    const falls = temps.slice(1).map((t, i) => temps[i] - t).filter((d) => d > 0);
    expect(falls).toHaveLength(10); // 35.0 °C down to 30.0 °C
    expect(Math.max(...falls)).toBe(1);
  });

  it("Taped reset button: the hold cannot clear; release, then a new press", () => {
    const { rt, op, w } = withOperator("held-button");
    until(rt, 11000);
    expect(rt.p0Down).toBe(true);
    expect(rt.controller.state.epo).toBe(true);
    expect(rt.getSnapshot().resetBlockers).toEqual(["held"]);
    expect(op.pressCalls).toEqual([]);
    until(rt, 13100);
    expect(rt.p0Down).toBe(false);
    expect(rt.controller.state.epo).toBe(true);
    run(rt, 12000);
    expect(rt.controller.state.epo).toBe(false);
    const accepted = w.outcomes.filter((o) => o.outcome === "accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].at).toBeGreaterThanOrEqual(14500);
    expect(op.pressCalls).toEqual([expect.objectContaining({ auto: true, held: false })]);
  });

  it("Noisy link: 5A changes nothing but the reject counter", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("corrupt");
    until(rt, 5400);
    const before = rt.controller.snapshot();
    until(rt, 5550);
    expect(rt.getSnapshot().lastFrame).toMatchObject({ kind: "corrupt", reply: [0x5a] });
    expect(rt.controller.snapshot()).toEqual({ ...before, crcRejects: 1 });
    expect(rt.controller.state.epo).toBe(true);
  });

  it("Bad input: both 3C rejections leave the state unchanged", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("invalid");
    until(rt, 2400);
    // the 3 s stream keeps metering energy in between; everything else must be untouched
    const before = { ...rt.controller.snapshot(), energy: 0 };
    until(rt, 5650);
    const after = { ...rt.controller.snapshot(), energy: 0 };
    expect(after).toEqual(before);
    expect(rt.getSnapshot().lastFrame?.reply).toEqual([0x3c]);
  });

  it("Leak with the link down: caught and reset with no telemetry", () => {
    const { rt, w } = withOperator("silent-leak");
    until(rt, 2100);
    const at = rt.lastSampleAt;
    run(rt, 30000);
    expect(rt.lastSampleAt).toBe(at);
    expect(rt.streaming).toBe(false);
    expect(rt.controller.state.epoTrips).toBe(1);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["accepted"]);
  });
});

describe("cancellation and manual interaction", () => {
  it("starting a new scenario cancels a pending automatic reset", () => {
    const { rt, op, w } = withOperator("critical", 3000);
    until(rt, 19000); // dispatched at 18.6 s and still walking
    expect(rt.recovery.phase).toBe("dispatched");
    expect(op.busy).toBe(true);
    rt.playScenario("normal");
    expect(op.cancels).toBeGreaterThan(0);
    expect(rt.recovery.phase).toBe("idle");
    run(rt, 30000);
    expect(w.outcomes.filter((o) => o.at > 19000)).toEqual([]);
    expect(rt.controller.state.epoTrips).toBe(0);
  });

  it("restart releases P0 and cancels every pending step and action", () => {
    const { rt, op } = withOperator("held-button");
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
    expect(rt.controller.state.latestTemp).toBe(44); // only the normal stream
    expect(op.pressCalls).toEqual([]);
  });

  it("a manual reset while the operator is on the way calls the operator off", () => {
    const { rt, op, w } = withOperator("critical", 3000);
    until(rt, 19000);
    expect(rt.recovery.phase).toBe("dispatched");
    rt.pressReset(false);
    expect(rt.controller.state.epo).toBe(false);
    expect(op.cancels).toBeGreaterThan(0);
    run(rt, 20000);
    expect(w.outcomes.map((o) => o.outcome)).toEqual(["temperature-critical", "accepted"]);
  });

  it("a terminal ramp walks one step at a time and never trips a runaway", () => {
    const rt = new SimulationRuntime();
    run(rt, 1000);
    rt.rampTo({ tempRaw: degCToRaw(33) });
    run(rt, 15000);
    expect(rt.controller.state).toMatchObject({ latestTemp: 66, tempClass: TEMP_CLASS.HOT, epo: false, rapid: false });
  });

  it("a sudden jump from the terminal is a thermal runaway", () => {
    const rt = new SimulationRuntime();
    run(rt, 1000);
    rt.setConditions({ amps: 20, degC: 26 }, true);
    expect(rt.controller.state).toMatchObject({ epo: true, rapid: true });
  });

  it("DCIM commands go through the same CRC check", () => {
    const rt = new SimulationRuntime();
    const r = rt.sendCommand(CMD.SET_POWER_LIMIT, 40);
    expect(r.reply).toEqual([0xa5]);
    expect(r.frame).toEqual(encodeCommand(CMD.SET_POWER_LIMIT, 40));
  });
});

describe("guided demo", () => {
  it("plays every beat: three trips, all cleared", () => {
    const rt = new SimulationRuntime();
    const demo = new GuidedDemo(rt);
    demo.start();
    for (let i = 1; i < DEMO_BEATS.length; i++) {
      run(rt, 3500);
      demo.next();
    }
    run(rt, 5000);
    expect(rt.controller.state.epo).toBe(false);
    expect(rt.controller.state.epoTrips).toBe(3);
    expect(rt.controller.state.eccUncorrectable).toBe(1);
    expect(rt.controller.pins).toBe(0x10);
  });

  it("rebuilds any beat instantly when stepping back", () => {
    const rt = new SimulationRuntime();
    const demo = new GuidedDemo(rt);
    demo.goTo(3);
    expect(rt.controller.pins).toBe(0xa0); // Critical: fans max + power-off
    demo.goTo(5);
    expect(rt.controller.pins).toBe(0x90); // Warm, still latched
    demo.goTo(6);
    expect(rt.controller.pins).toBe(0x10);
    demo.goTo(7);
    expect(rt.controller.pins).toBe(0x90); // leak
  });
});
