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
  it("records the critical-heat incident in causal order", () => {
    const rt = play("critical-heat");
    const titles = rt.getSnapshot().timeline.map((e) => e.title);
    const idx = (s: string) => titles.findIndex((t) => t.includes(s));
    expect(idx("Scenario started")).toBe(0);
    expect(idx("Telemetry 32.5 °C")).toBeGreaterThan(0);
    expect(idx("Temperature Normal → Critical")).toBeGreaterThan(idx("Telemetry 32.5 °C"));
    expect(idx("P5 maximum fan on")).toBeGreaterThan(idx("Telemetry 32.5 °C"));
    expect(idx("P7 EPO request latched")).toBeGreaterThan(idx("P5 maximum fan on"));
    expect(idx("Recovery reading")).toBeGreaterThan(idx("P7 EPO request latched"));
    expect(idx("P0 accepted")).toBeGreaterThan(idx("Recovery reading"));
    expect(idx("Scenario completed")).toBe(titles.length - 1);
  });

  it("does not record routine samples that change nothing", () => {
    const rt = new SimulationRuntime();
    for (let t = 0; t < 20000; t += 16) rt.advance(16);
    // the first sample (no reading yet → a reading) is recorded; the repeats are not
    expect(rt.getSnapshot().timeline.length).toBe(1);
  });

  it("restart clears the record", () => {
    const rt = play("current-trip");
    expect(rt.getSnapshot().timeline.length).toBeGreaterThan(3);
    rt.restart();
    expect(rt.getSnapshot().timeline).toEqual([]);
    expect(rt.getSnapshot().chain).toBeNull();
  });

  it("stamps each entry with the state it left behind", () => {
    const rt = play("critical-heat");
    const latch = rt.getSnapshot().timeline.find((e) => e.kind === "epo")!;
    expect(latch.values.epo).toBe(true);
    expect(latch.values.pins & 0xa0).toBe(0xa0);
  });
});

describe("causality chain", () => {
  it("explains a latch from input to output", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ volts: 230, amps: 25.4, degC: 26.5 }, true);
    rt.setConditions({ volts: 230, amps: 25.4, degC: 32.5 }, true);
    const c = rt.getSnapshot().chain!;
    expect(c.nodes.map((n) => n.label)).toEqual([
      "32.5 °C · 25.4 A telemetry",
      "CRC accepted",
      "Critical temperature",
      "P5 maximum fan",
      "P7 EPO request latched",
    ]);
    expect(c.before.epo).toBe(false);
    expect(c.after.epo).toBe(true);
  });

  it("shows a rejected packet changing nothing", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ volts: 230, amps: 25.4, degC: 32.5 }, true);
    rt.runStep({ at: 0, type: "corrupt", amps: 25.4, degC: 26.5 }, false);
    const c = rt.getSnapshot().chain!;
    expect(c.nodes.map((n) => n.label)).toEqual(["Packet received", "CRC check failed", "Reply 0x5A", "Controller state unchanged"]);
    expect(c.after).toEqual(c.before);
  });

  it("explains a refused and an accepted P0 press", () => {
    const rt = new SimulationRuntime();
    rt.setConditions({ volts: 230, amps: 25.4, degC: 32.5 }, true);
    rt.setConditions({ volts: 230, amps: 25.4, degC: 30 }, true);
    rt.pressReset(false);
    expect(rt.getSnapshot().chain!.nodes.map((n) => n.label)).toContain("Reset refused");
    rt.buttonUp();
    rt.setConditions({ volts: 230, amps: 25.4, degC: 26.5 }, true);
    rt.pressReset(false);
    const c = rt.getSnapshot().chain!;
    expect(c.kind).toBe("reset");
    expect(c.nodes.at(-1)!.label).toBe("P7 EPO request cleared");
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
    rt.playScenario("warm");
    const snap = rt.getSnapshot();
    expect(evaluateEvidence("warm", snap.timeline, snap.controller, false).every((r) => r.status === "pending")).toBe(true);
  });
});
