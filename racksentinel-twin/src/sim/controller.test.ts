import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/emu-golden.json";
import { CFG, DEFAULTS, RackSentinelController, TEMP_CLASS, resetBlockers, settingsView } from "./controller";
import { crc16 } from "./crc";
import { eccDecode, eccEncode } from "./ecc";
import { runEmu } from "./emu";
import { CMD, REPLY, encodeCommand, frameValue } from "./protocol";
import { energyWh } from "./units";

/**
 * The golden lines come from the model in stage4_fpga/rack_demo.html: R1 to R9 passed on the
 * AWS FPGA (stage4_fpga/evidence/fpga_emu_R*.png) and seeds 1 to 1000 were replayed on the RTL.
 * Each line carries its own expected replies (-r) and pins (-o).
 */
describe("matches the FPGA-verified runs R1 to R9", () => {
  for (const { id, line } of golden.fixed) {
    it(`${id}: every reply and pin matches`, () => {
      const run = runEmu(line);
      const bad = run.steps[run.firstFailure];
      expect(run.passed, bad ? `${bad.arg}: got 0x${bad.actual?.toString(16)}` : "").toBe(true);
    });
  }
});

describe("matches the 1,000 RTL-verified demo cases", () => {
  it("every seed passes", () => {
    const failures = golden.seeds.filter(({ line }) => !runEmu(line).passed).map((s) => s.seed);
    expect(failures).toEqual([]);
  });
});

describe("CRC and ECC primitives", () => {
  it("CRC-16/CCITT check value", () => {
    expect(crc16([..."123456789"].map((c) => c.charCodeAt(0)))).toBe(0x29b1);
  });
  it("TEMP 22.0 °C encodes as in R1", () => {
    expect(frameValue(encodeCommand(CMD.TEMP, 0x2c))).toBe(0xfe072c20);
  });
  it("ECC round-trips every byte and fixes every single flip", () => {
    for (let d = 0; d < 256; d++) {
      const w = eccEncode(d);
      expect(eccDecode(w)).toMatchObject({ value: d, status: 0 });
      for (let b = 0; b < 13; b++) expect(eccDecode(w ^ (1 << b))).toMatchObject({ value: d, status: 1 });
      for (let a = 0; a < 13; a++) for (let b = a + 1; b < 13; b++) expect(eccDecode(w ^ (1 << a) ^ (1 << b)).status).toBe(2);
    }
  });
  it("energy ÷ 300 is exact (spot checks across the range)", () => {
    for (const e of [0, 299, 300, 69000, 1e6 + 7, 0x7fffffff, 0xffffffff]) expect(energyWh(e)).toBe(Math.floor(e / 300));
  });
});

describe("rules in plain cases", () => {
  const send = (c: RackSentinelController, cmd: number, d: number) => c.receiveFrame(encodeCommand(cmd, d));

  it("boots with the documented defaults", () => {
    const c = new RackSentinelController();
    expect(settingsView(c.state).slice(0, 6).map((v) => v.value)).toEqual([...DEFAULTS]);
    expect(c.pins).toBe(0);
  });

  it("a reading on a threshold takes the higher class", () => {
    const c = new RackSentinelController();
    send(c, CMD.SET_RISE, 0);
    for (const [raw, cls] of [[53, 0], [54, 1], [63, 1], [64, 2], [69, 2], [70, 3]] as const) {
      send(c, CMD.TEMP, raw);
      expect(c.state.tempClass, `raw ${raw}`).toBe(cls);
    }
  });

  it("reset is allowed below Critical but refused while the leak sensor is wet", () => {
    const c = new RackSentinelController();
    send(c, CMD.TEMP, 70);
    expect(c.state.epo).toBe(true);
    c.setLeak(true);
    send(c, CMD.TEMP, 60); // Warm (rise is negative)
    expect(resetBlockers(c.state, false)).toEqual(["leak"]);
    expect(c.setP0(true).reset).toBe("leak");
    c.setP0(false);
    c.setLeak(false);
    expect(c.setP0(true).reset).toBe("accepted");
    expect(c.state.tempClass).toBe(TEMP_CLASS.WARM);
  });

  it("a held button never clears a later trip", () => {
    const c = new RackSentinelController();
    c.setP0(true);
    send(c, CMD.TEMP, 70);
    send(c, CMD.TEMP, 50);
    expect(c.setP0(true).reset).toBe("held");
    expect(c.state.epo).toBe(true);
  });

  it("bad CRC changes nothing and is counted", () => {
    const c = new RackSentinelController();
    const f = encodeCommand(CMD.TEMP, 50, 0x01);
    expect(c.receiveFrame(f).reply).toEqual([REPLY.BAD_CRC]);
    expect(c.state.gotTemp).toBe(false);
    expect(c.state.crcRejects).toBe(1);
  });

  it("a two-bit flip in the power limit trips on the next CURRENT reading", () => {
    const c = new RackSentinelController();
    send(c, CMD.FLIP_TEST, 0x10 | CFG.POWER_LIMIT);
    send(c, CMD.CURRENT, 50);
    expect(c.state.epo).toBe(true);
    expect(c.state.fault).toBe(1 << CFG.POWER_LIMIT);
    send(c, CMD.SET_POWER_LIMIT, 59);
    expect(c.state.fault).toBe(0);
  });
});

describe("data-flow cases", () => {
  it("every case passes on the model, and R1 to R9 are the FPGA lines verbatim", async () => {
    const { FLOW_CASES } = await import("./cases");
    for (const c of FLOW_CASES) expect(runEmu(c.line).passed, c.id).toBe(true);
    const fpga = FLOW_CASES.filter((c) => c.fpga).map((c) => c.line);
    expect(fpga).toEqual(golden.fixed.map((f) => f.line));
  });
});
