import { describe, expect, it } from "vitest";
import { SimulationRuntime } from "./runtime";
import { SCENARIOS } from "./scenarios";
import { evaluateEvidence, hasEvidence } from "./evidence";

function play(id: string, ms = 45000) {
  const rt = new SimulationRuntime();
  rt.playScenario(id);
  for (let t = 0; t < ms; t += 16) rt.advance(16);
  return rt;
}

describe("incident timeline", () => {
  it("records the overheat incident in causal order", () => {
    const rt = play("critical");
    const titles = rt.getSnapshot().timeline.map((e) => e.title);
    const idx = (s: string) => titles.findIndex((t) => t.includes(s));
    expect(idx("Scenario started")).toBe(0);
    expect(idx("Reading TEMP 35.0 °C")).toBeGreaterThan(0);
    expect(idx("Temperature Hot → Critical")).toBeGreaterThan(idx("Reading TEMP 35.0 °C"));
    expect(idx("P7 power-off latched")).toBeGreaterThan(idx("Temperature Hot → Critical"));
    expect(idx("P0 refused · temperature Critical")).toBeGreaterThan(idx("P7 power-off latched"));
    expect(idx("Recovery reading")).toBeGreaterThan(idx("P0 refused"));
    expect(idx("P0 accepted")).toBeGreaterThan(idx("Recovery reading"));
    expect(idx("TRIP_INFO")).toBeGreaterThan(idx("P0 accepted"));
    expect(idx("Scenario completed")).toBe(titles.length - 1);
  });

  it("does not record routine readings that change nothing", () => {
    const rt = new SimulationRuntime();
    for (let t = 0; t < 20000; t += 16) rt.advance(16);
    // the first TEMP and CURRENT (no reading yet → a reading) are recorded; the repeats are not
    expect(rt.getSnapshot().timeline.length).toBe(2);
  });

  it("restart clears the record", () => {
    const rt = play("leak");
    expect(rt.getSnapshot().timeline.length).toBeGreaterThan(3);
    rt.restart();
    expect(rt.getSnapshot().timeline).toEqual([]);
    expect(rt.getSnapshot().chain).toBeNull();
  });

  it("stamps each entry with the state it left behind", () => {
    const rt = play("critical");
    const latch = rt.getSnapshot().timeline.find((e) => e.kind === "epo")!;
    expect(latch.values.epo).toBe(true);
    expect(latch.values.pins & 0xa0).toBe(0xa0);
  });
});

describe("causality chain", () => {
  it("explains a latch from input to output", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ amps: 20, degC: 34.5 }, true);
    rt.setConditions({ amps: 20, degC: 35.0 }, true);
    // the CURRENT packet after it changed nothing, so the TEMP decision stays on the ribbon
    const c = rt.getSnapshot().chain!;
    expect(c.nodes.map((n) => n.label)).toEqual(["TEMP 35.0 °C", "CRC accepted", "Critical temperature", "P7 power-off · Critical temperature"]);
    expect(c.before.epo).toBe(false);
    expect(c.after.epo).toBe(true);
  });

  it("shows a damaged packet changing nothing", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ amps: 20, degC: 34.5 }, true);
    rt.runStep({ at: 0, type: "corrupt", degC: 26 }, false);
    const c = rt.getSnapshot().chain!;
    expect(c.nodes.map((n) => n.label)).toEqual(["Packet received", "CRC check failed", "Reply 0x5A", "State unchanged"]);
    expect(c.after).toEqual(c.before);
  });

  it("explains a leak trip without any packet", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ amps: 20, degC: 22 }, true);
    rt.setLeak(true);
    const c = rt.getSnapshot().chain!;
    expect(c.kind).toBe("leak");
    expect(c.nodes.at(-1)!.label).toBe("P7 power-off · water leak");
  });

  it("explains a refused and an accepted P0 press", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ amps: 20, degC: 34.5 }, true);
    rt.setConditions({ amps: 20, degC: 35.0 }, true);
    rt.pressReset(false);
    expect(rt.getSnapshot().chain!.nodes.map((n) => n.label)).toContain("Reset refused");
    rt.buttonUp();
    rt.setConditions({ amps: 20, degC: 34.5 }, true);
    rt.pressReset(false);
    const c = rt.getSnapshot().chain!;
    expect(c.kind).toBe("reset");
    expect(c.nodes.at(-1)!.label).toBe("P7 power-off cleared");
    expect(c.before.epo).toBe(true);
    expect(c.after.epo).toBe(false);
  });
});

describe("evidence mode", () => {
  it("covers every scenario", () => {
    for (const s of SCENARIOS) expect(hasEvidence(s.id), s.id).toBe(true);
  });

  for (const s of SCENARIOS) {
    it(`${s.id}: every expected result is observed`, () => {
      const rt = play(s.id);
      const snap = rt.getSnapshot();
      expect(snap.scenario?.running).toBe(false);
      const results = evaluateEvidence(s.id, snap.timeline, snap.controller, true);
      for (const r of results) expect(r.status, `${r.label}: expected ${r.expected}, observed ${r.observed}`).toBe("pass");
    });
  }

  it("a fresh scenario is pending, not failed", () => {
    const rt = new SimulationRuntime();
    rt.playScenario("heat-up");
    const snap = rt.getSnapshot();
    expect(evaluateEvidence("heat-up", snap.timeline, snap.controller, false).every((r) => r.status === "pending")).toBe(true);
  });
});
