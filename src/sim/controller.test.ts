import { describe, expect, it, beforeEach } from "vitest";
import { crc16 } from "./crc";
import { RackSentinelController, TEMP_CLASS, classifyTemperature, resetBlockers } from "./controller";
import { CMD, REPLY, encodeCommand, encodeSample } from "./protocol";
import { ampsToRaw, degCToRaw } from "./units";

/** Send a sample in real units; returns [reply byte, pins]. */
function sample(c: RackSentinelController, volts: number, amps: number, degC: number, corrupt = false) {
  const r = c.receiveFrame(encodeSample(volts, ampsToRaw(amps), degCToRaw(degC), corrupt));
  return [r.reply[0], c.pins] as const;
}
function sampleRaw(c: RackSentinelController, v: number, i: number, t: number) {
  const r = c.receiveFrame(encodeSample(v, i, t));
  return [r.reply[0], c.pins] as const;
}
function status(c: RackSentinelController) {
  return c.receiveFrame(encodeCommand(CMD.STATUS, 0)).reply;
}
/** Press and release P0; returns the press outcome and the pins seen while pressed. */
function pressRelease(c: RackSentinelController) {
  const press = c.setP0(true);
  const pinsWhilePressed = c.pins;
  c.setP0(false);
  return { outcome: press.outcome, pins: pinsWhilePressed };
}

describe("CRC-16/CCITT (poly 0x1021, init 0xFFFF)", () => {
  it("matches the worked example in Documentation/10", () => {
    expect(crc16([0x5a, 0xe6, 0x7f, 0x35])).toBe(0xf550);
    expect(crc16([0x50, 0x00])).toBe(0x13b0);
  });

  it("matches every CRC in the verified ./emu command lines", () => {
    const cases: [number, number, number, number][] = [
      [230, 127, 54, 0xc533],
      [230, 127, 64, 0xdb62],
      [230, 127, 65, 0xcb43],
      [230, 127, 50, 0x85b7],
      [230, 128, 50, 0x8648],
      [230, 160, 50, 0x80ae],
      [230, 161, 50, 0xb39f],
      [230, 161, 65, 0xfd6b],
      [230, 128, 54, 0xc6cc],
      [230, 127, 0, 0x93a6],
    ];
    for (const [v, i, t, want] of cases) expect(crc16([0x5a, v, i, t])).toBe(want);
  });

  it("encodes CRC low byte first", () => {
    expect(encodeSample(230, 127, 53)).toEqual([0x5a, 0xe6, 0x7f, 0x35, 0x50, 0xf5]);
    expect(encodeCommand(CMD.STATUS, 0)).toEqual([0x50, 0x00, 0xb0, 0x13]);
  });
});

describe("Official test cases C01–C12 (TESTCASES_FINAL_C01-C12.md)", () => {
  let c: RackSentinelController;
  beforeEach(() => {
    c = new RackSentinelController();
  });

  it("C01 normal temperature and current", () => {
    expect(sample(c, 230, 25.4, 26.5)).toEqual([REPLY.OK, 0x00]);
    expect(status(c)).toEqual([0x40, 0x35, 0x7f, 0x00]);
  });

  it("C02 warm boundaries", () => {
    expect(sample(c, 230, 25.4, 27.0)).toEqual([REPLY.OK, 0x10]);
    expect(sample(c, 230, 25.4, 32.0)).toEqual([REPLY.OK, 0x10]);
    expect(status(c)).toEqual([0x41, 0x40, 0x7f, 0x00]);
  });

  it("C03 temperature critical", () => {
    expect(sample(c, 230, 25.4, 32.5)).toEqual([REPLY.OK, 0xa0]);
    expect(status(c)).toEqual([0x4b, 0x41, 0x7f, 0x01]);
  });

  it("C04 current boundaries", () => {
    expect(sample(c, 230, 25.4, 25.0)).toEqual([REPLY.OK, 0x00]);
    expect(sample(c, 230, 25.6, 25.0)).toEqual([REPLY.OK, 0x40]);
    expect(sample(c, 230, 32.0, 25.0)).toEqual([REPLY.OK, 0x40]);
  });

  it("C05 current critical", () => {
    expect(sample(c, 230, 32.2, 25.0)).toEqual([REPLY.OK, 0xc0]);
    expect(status(c)).toEqual([0x4c, 0x32, 0xa1, 0x01]);
  });

  it("C06 either fault is enough", () => {
    expect(sample(c, 230, 32.2, 32.5)).toEqual([REPLY.OK, 0xe0]);
    expect(sample(c, 230, 32.2, 25.0)).toEqual([REPLY.OK, 0xc0]);
    expect(sample(c, 230, 25.4, 32.5)).toEqual([REPLY.OK, 0xa0]);
  });

  it("C07 both must become normal; EPO latched until P0", () => {
    expect(sample(c, 230, 32.2, 32.5)).toEqual([REPLY.OK, 0xe0]);
    expect(sample(c, 230, 25.6, 27.0)).toEqual([REPLY.OK, 0xd0]);
    expect(sample(c, 230, 25.4, 26.5)).toEqual([REPLY.OK, 0x80]);
    expect(pressRelease(c)).toEqual({ outcome: "accepted", pins: 0x00 });
  });

  it("C08 warm temperature blocks recovery", () => {
    expect(sample(c, 230, 25.4, 32.5)).toEqual([REPLY.OK, 0xa0]);
    expect(sample(c, 230, 25.4, 32.0)).toEqual([REPLY.OK, 0x90]);
    expect(sample(c, 230, 25.4, 26.5)).toEqual([REPLY.OK, 0x80]);
    expect(pressRelease(c)).toEqual({ outcome: "accepted", pins: 0x00 });
  });

  it("C09 warning current blocks recovery", () => {
    expect(sample(c, 230, 32.2, 25.0)).toEqual([REPLY.OK, 0xc0]);
    expect(sample(c, 230, 25.6, 25.0)).toEqual([REPLY.OK, 0xc0]);
    expect(pressRelease(c)).toEqual({ outcome: "current-warning", pins: 0xc0 });
    expect(sample(c, 230, 25.4, 25.0)).toEqual([REPLY.OK, 0x80]);
    expect(pressRelease(c)).toEqual({ outcome: "accepted", pins: 0x00 });
  });

  it("C10 invalid packets change nothing", () => {
    expect(sample(c, 230, 25.4, 32.5)).toEqual([REPLY.OK, 0xa0]);
    expect(sampleRaw(c, 230, 127, 0)).toEqual([REPLY.INVALID, 0xa0]);
    expect(sample(c, 230, 25.4, 26.5, true)).toEqual([REPLY.BAD_CRC, 0xa0]);
  });

  it("C11 P0 refused until temperature and current are safe", () => {
    expect(sample(c, 230, 25.4, 32.5)).toEqual([REPLY.OK, 0xa0]);
    expect(pressRelease(c)).toEqual({ outcome: "temperature-critical", pins: 0xa0 });
    expect(sample(c, 230, 25.4, 27.0)).toEqual([REPLY.OK, 0x90]);
    expect(pressRelease(c)).toEqual({ outcome: "temperature-warm", pins: 0x90 });
    expect(sample(c, 230, 25.4, 26.5)).toEqual([REPLY.OK, 0x80]);
    expect(pressRelease(c)).toEqual({ outcome: "accepted", pins: 0x00 });
  });

  it("C12 a held P0 never clears the EPO", () => {
    c.setP0(true); // held from the start
    expect(sample(c, 230, 32.2, 25.0)).toEqual([REPLY.OK, 0xc0]);
    expect(c.setP0(true).outcome).toBe("held");
    expect(sample(c, 230, 25.4, 25.0)).toEqual([REPLY.OK, 0x80]);
    expect(c.setP0(true).outcome).toBe("held");
    expect(c.pins).toBe(0x80);
    c.setP0(false);
    expect(c.setP0(true).outcome).toBe("accepted");
    expect(c.pins).toBe(0x00);
  });
});

describe("Required behaviours", () => {
  let c: RackSentinelController;
  beforeEach(() => {
    c = new RackSentinelController();
  });

  it("1. normal temperature and current: no outputs", () => {
    sample(c, 230, 25.4, 26.5);
    expect(c.state.tempClass).toBe(TEMP_CLASS.NORMAL);
    expect(c.state.overload).toBe(false);
    expect(c.pins).toBe(0);
  });

  it("2. warm lower boundary at 27.0 °C", () => {
    expect(sample(c, 230, 25.4, 27.0)[1]).toBe(0x10);
    expect(classifyTemperature(degCToRaw(26.5))).toBe(TEMP_CLASS.NORMAL);
    expect(classifyTemperature(degCToRaw(27.0))).toBe(TEMP_CLASS.WARM);
  });

  it("3. warm upper boundary at exactly 32.0 °C", () => {
    expect(sample(c, 230, 25.4, 32.0)[1]).toBe(0x10);
    expect(c.state.epo).toBe(false);
  });

  it("4. critical temperature at 32.5 °C", () => {
    expect(sample(c, 230, 25.4, 32.5)[1]).toBe(0xa0);
    expect(c.state.tempClass).toBe(TEMP_CLASS.CRITICAL);
  });

  it("5. normal current at 25.4 A", () => {
    expect(sample(c, 230, 25.4, 25.0)[1]).toBe(0x00);
  });

  it("6. current warning at 25.6 A", () => {
    expect(sample(c, 230, 25.6, 25.0)[1]).toBe(0x40);
  });

  it("7. current warning at exactly 32.0 A, no trip", () => {
    expect(sample(c, 230, 32.0, 25.0)[1]).toBe(0x40);
    expect(c.state.epo).toBe(false);
  });

  it("8. current trip at 32.2 A", () => {
    expect(sample(c, 230, 32.2, 25.0)[1]).toBe(0xc0);
    expect(c.state.epo).toBe(true);
  });

  it("9. temperature-only trip", () => {
    sample(c, 230, 10.0, 40.0);
    expect(c.pins).toBe(0xa0);
  });

  it("10. current-only trip", () => {
    sample(c, 230, 40.0, 20.0);
    expect(c.pins).toBe(0xc0);
  });

  it("11. combined trip", () => {
    sample(c, 230, 40.0, 40.0);
    expect(c.pins).toBe(0xe0);
    expect(c.state.epoTrips).toBe(1);
  });

  it("12. safe readings do not automatically clear EPO", () => {
    sample(c, 230, 25.4, 32.5);
    for (let k = 0; k < 10; k++) sample(c, 230, 10, 20);
    expect(c.state.epo).toBe(true);
    expect(c.pins).toBe(0x80);
  });

  it("13. reset while warm is refused", () => {
    sample(c, 230, 25.4, 32.5);
    sample(c, 230, 25.4, 30.0);
    expect(pressRelease(c).outcome).toBe("temperature-warm");
    expect(c.state.epo).toBe(true);
  });

  it("14. reset while current is at warning is refused", () => {
    sample(c, 230, 32.2, 25.0);
    sample(c, 230, 25.6, 25.0);
    expect(pressRelease(c).outcome).toBe("current-warning");
    expect(c.state.epo).toBe(true);
  });

  it("15. a safe new P0 press clears EPO", () => {
    sample(c, 230, 25.4, 32.5);
    sample(c, 230, 25.4, 26.5);
    expect(pressRelease(c).outcome).toBe("accepted");
    expect(c.state.epo).toBe(false);
    expect(c.pins).toBe(0);
  });

  it("16. a held P0 cannot clear a later EPO", () => {
    sample(c, 230, 25.4, 26.5);
    expect(c.setP0(true).outcome).toBe("not-latched"); // pressed while nothing to reset
    sample(c, 230, 25.4, 33.0); // trip while held
    sample(c, 230, 25.4, 26.0);
    expect(c.setP0(true).outcome).toBe("held");
    expect(c.state.epo).toBe(true);
    expect(resetBlockers(c.state, true)).toEqual(["held"]);
  });

  it("17. invalid telemetry preserves state", () => {
    sample(c, 230, 25.4, 32.5);
    const before = c.snapshot();
    for (const [v, i, t] of [[179, 127, 53], [255, 127, 53], [230, 255, 53], [230, 127, 0], [230, 127, 255]]) {
      expect(sampleRaw(c, v, i, t)[0]).toBe(REPLY.INVALID);
    }
    expect(c.snapshot()).toEqual(before);
  });

  it("17b. voltage is validated and stored but never trips", () => {
    expect(sampleRaw(c, 180, 127, 53)).toEqual([REPLY.OK, 0]);
    expect(sampleRaw(c, 254, 127, 53)).toEqual([REPLY.OK, 0]);
    expect(c.state.voltage).toBe(254);
  });

  it("18. bad CRC preserves state and counts the rejection", () => {
    sample(c, 230, 25.4, 32.5);
    const before = c.snapshot();
    expect(sample(c, 230, 25.4, 26.5, true)[0]).toBe(REPLY.BAD_CRC);
    expect(c.snapshot()).toEqual({ ...before, crcRejects: 1 });
    expect(c.receiveFrame(encodeCommand(CMD.COUNTERS, 0)).reply).toEqual([1, 0, 0, 0]);
  });

  it("19. EPO trip count increments once per latch, not per sample", () => {
    sample(c, 230, 25.4, 32.5);
    sample(c, 230, 25.4, 33.0);
    sample(c, 230, 40, 33.0);
    expect(c.state.epoTrips).toBe(1);
    sample(c, 230, 25.4, 26.5);
    pressRelease(c);
    sample(c, 230, 40, 20);
    expect(c.state.epoTrips).toBe(2);
    expect(status(c)[3]).toBe(2);
  });

  it("20. no telemetry preserves the last state; P0 still works locally", () => {
    sample(c, 230, 25.4, 32.5);
    sample(c, 230, 25.4, 26.5);
    const before = c.snapshot();
    // Nothing arrives: the model has no clock-driven decay, so state is unchanged.
    expect(c.snapshot()).toEqual(before);
    expect(pressRelease(c).outcome).toBe("accepted");
  });
});

describe("Protocol details", () => {
  let c: RackSentinelController;
  beforeEach(() => {
    c = new RackSentinelController();
  });

  it("unknown and removed commands reply 0x3C", () => {
    expect(c.receiveFrame(encodeCommand(0x47, 0)).reply).toEqual([REPLY.INVALID]);
    expect(c.receiveFrame(encodeCommand(0x51, 0)).reply).toEqual([REPLY.INVALID]);
  });

  it("STATUS with non-zero data is invalid", () => {
    expect(c.receiveFrame(encodeCommand(CMD.STATUS, 1)).reply).toEqual([REPLY.INVALID]);
  });

  it("a truncated frame times out with no reply and no change", () => {
    const before = c.snapshot();
    const r = c.receiveBytes([0x5a, 230, 127]);
    expect(r[0].outcome).toBe("timeout");
    expect(r[0].reply).toEqual([]);
    expect(c.snapshot()).toEqual(before);
  });

  it("threshold commands follow the staged high byte rules", () => {
    expect(c.receiveFrame(encodeCommand(CMD.SET_WARM, 0x04)).reply).toEqual([REPLY.INVALID]); // nothing staged
    c.receiveFrame(encodeCommand(CMD.STAGE_HIGH, 0x01));
    expect(status(c)[0] & 0x80).toBe(0x80);
    expect(c.receiveFrame(encodeCommand(CMD.SET_WARM, 0x04)).reply).toEqual([REPLY.OK]); // 0x104 = 26.0 °C
    expect(c.state.thrWarm).toBe(0x104);
    expect(sample(c, 230, 10, 26.0)[1]).toBe(0x10);
  });

  it("current thresholds are validated against each other", () => {
    expect(c.receiveFrame(encodeCommand(CMD.SET_WARN_CURRENT, 160)).reply).toEqual([REPLY.INVALID]);
    expect(c.receiveFrame(encodeCommand(CMD.SET_TRIP_CURRENT, 128)).reply).toEqual([REPLY.INVALID]);
    expect(c.receiveFrame(encodeCommand(CMD.SET_WARN_CURRENT, 100)).reply).toEqual([REPLY.OK]);
  });

  it("several frames in one stream are processed in order", () => {
    const r = c.receiveBytes([...encodeSample(230, 127, 65), ...encodeCommand(CMD.STATUS, 0)]);
    expect(r.map((x) => x.reply)).toEqual([[REPLY.OK], [0x4b, 0x41, 0x7f, 0x01]]);
  });
});
