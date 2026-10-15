/**
 * RackSentinel v2 controller model.
 *
 * A deterministic, byte-level model of the v2 firmware (rack_sentinel.s, the ROM in
 * stage4_fpga/riscv.sv), ported from the model in stage4_fpga/rack_demo.html that JX replayed
 * on the RTL for 1,000 cases and whose nine rehearsed runs passed on the AWS FPGA.
 * controller.test.ts replays all of them against this file.
 *
 * No rendering or UI code lives here.
 */
import { crc16 } from "./crc";
import { ECC_WIDTH, FLIP_ONE, FLIP_TWO, eccDecode, eccEncode, type EccStatus } from "./ecc";
import { CAUSE, CMD, INPUT, PIN, REPLY, STATUS_FLAG, causeText } from "./protocol";
import { energyWh, fmtAmps, fmtDegC, fmtKW, fmtLimit } from "./units";

/** Temperature class (ST_CLASS, STATUS bits 1:0). */
export const TEMP_CLASS = { NORMAL: 0, WARM: 1, HOT: 2, CRITICAL: 3 } as const;
export type TempClass = (typeof TEMP_CLASS)[keyof typeof TEMP_CLASS];
export const CLASS_NAME = ["Normal", "Warm", "Hot", "Critical"] as const;

/** The nine ECC-protected words (FLIP_TEST word numbers). */
export const CFG = {
  WARM: 0,
  HOT: 1,
  CRIT: 2,
  RISE: 3,
  VOLTAGE: 4,
  POWER_LIMIT: 5,
  TRIP_CAUSE: 6,
  TRIP_TEMP: 7,
  TRIP_CURRENT: 8,
} as const;
export const CFG_NAMES = [
  "Warm threshold",
  "Hot threshold",
  "Critical threshold",
  "Runaway limit",
  "Supply voltage",
  "Power limit",
  "Trip record: cause",
  "Trip record: temperature",
  "Trip record: current",
] as const;
/** Settings 0..5 (the fault flag only covers these; trip-record faults never block a reset). */
export const SETTINGS_MASK = 0x3f;

/** Boot defaults: 27.0 / 32.0 / 35.0 °C, runaway 2.0 °C, 230 V, 5.9 kW. */
export const DEFAULTS = [54, 64, 70, 4, 230, 59] as const;

export type NoteKind = "info" | "warn" | "bad" | "fix" | "trip";
/** What the firmware did while handling one input, in order. */
export interface Note {
  kind: NoteKind;
  text: string;
}

export interface ControllerState {
  /** The nine 13-bit codewords as stored in DMEM. */
  cfg: number[];
  /** One bit per setting 0..5 that had a 2-bit error and has not been rewritten. */
  fault: number;
  latestTemp: number;
  gotTemp: boolean;
  tempClass: TempClass;
  /** The latest reading rose by at least the runaway limit. */
  rapid: boolean;
  latestCurrent: number;
  gotCurrent: boolean;
  /** V × I_raw in 0.2 W units, null before the first CURRENT. */
  power: number | null;
  overload: boolean;
  /** Energy in 0.2 W·min, saturating at 0xFFFFFFFF. */
  energy: number;
  epo: boolean;
  epoTrips: number;
  crcRejects: number;
  eccCorrected: number;
  eccUncorrectable: number;
  btnPrev: boolean;
  /** Input pin levels P3..P0 as the GPIO sees them (bit 0 reset, bit 1 leak). */
  inputs: number;
  /** GPIO output byte; P7..P4 live in the upper nibble. */
  pins: number;
}

export type FrameOutcome = "accepted" | "invalid" | "bad-crc" | "data";

export interface FrameResult {
  frame: number[];
  command: number;
  outcome: FrameOutcome;
  /** Bytes the controller sends back. */
  reply: number[];
  notes: Note[];
}

export type ResetOutcome = "accepted" | "not-latched" | "held" | "released" | "leak" | "temperature-critical" | "runaway" | "config-fault";

export interface PollResult {
  /** The leak sensor latched the EPO during this poll. */
  leakTrip: boolean;
  /** The P0 evaluation, when the button level is high. */
  reset: ResetOutcome | null;
  /** True when this poll saw a new 0→1 transition on P0. */
  newPress: boolean;
  notes: Note[];
}

/** A decoded view of one protected word, without side effects (for display). */
export interface SettingView {
  value: number;
  /** 0 clean, 1 one bit flipped (repaired at next use), 2 unreadable. */
  status: EccStatus;
}

function initialState(): ControllerState {
  const cfg = new Array<number>(9).fill(0);
  for (let k = 0; k < DEFAULTS.length; k++) cfg[k] = eccEncode(DEFAULTS[k]);
  return {
    cfg,
    fault: 0,
    latestTemp: 0,
    gotTemp: false,
    tempClass: TEMP_CLASS.NORMAL,
    rapid: false,
    latestCurrent: 0,
    gotCurrent: false,
    power: null,
    overload: false,
    energy: 0,
    epo: false,
    epoTrips: 0,
    crcRejects: 0,
    eccCorrected: 0,
    eccUncorrectable: 0,
    btnPrev: false,
    inputs: 0,
    pins: 0,
  };
}

/** Output byte from the state (update_outputs). */
export function computePins(s: Pick<ControllerState, "tempClass" | "overload" | "epo">): number {
  let p = 0;
  if (s.tempClass === TEMP_CLASS.WARM) p = PIN.FAN_BOOST;
  else if (s.tempClass >= TEMP_CLASS.HOT) p = PIN.FAN_MAX;
  if (s.overload) p |= PIN.OVERLOAD;
  if (s.epo) p |= PIN.EPO;
  return p;
}

/** Decoded settings view (no counting, no scrubbing). */
export function settingsView(s: ControllerState): SettingView[] {
  return s.cfg.map((w, k) => {
    const d = eccDecode(w);
    const status: EccStatus = k < 6 && s.fault & (1 << k) ? 2 : d.status;
    return { value: d.value, status };
  });
}

/**
 * Everything currently preventing a P0 press from clearing the EPO, in firmware check order.
 * Empty when a new press would be accepted.
 */
export function resetBlockers(s: ControllerState, p0Held: boolean): ResetOutcome[] {
  if (!s.epo) return ["not-latched"];
  const out: ResetOutcome[] = [];
  if (p0Held) out.push("held");
  if (s.inputs & INPUT.LEAK) out.push("leak");
  if (s.tempClass === TEMP_CLASS.CRITICAL) out.push("temperature-critical");
  if (s.rapid) out.push("runaway");
  if (s.fault & SETTINGS_MASK) out.push("config-fault");
  return out;
}

export function statusFlags(s: ControllerState): number {
  return (
    (s.tempClass & STATUS_FLAG.CLASS_MASK) |
    (s.overload ? STATUS_FLAG.OVERLOAD : 0) |
    (s.epo ? STATUS_FLAG.EPO_LATCHED : 0) |
    (s.inputs & INPUT.LEAK ? STATUS_FLAG.LEAK : 0) |
    (s.rapid ? STATUS_FLAG.RUNAWAY : 0) |
    (s.gotTemp ? STATUS_FLAG.GOT_TEMPERATURE : 0) |
    (s.fault & SETTINGS_MASK ? STATUS_FLAG.CONFIG_FAULT : 0)
  );
}

const sat = (n: number) => (n < 255 ? n + 1 : n);
const settingText = (k: number, v: number) =>
  k <= 2 ? fmtDegC(v) : k === CFG.RISE ? (v === 0 ? "off" : `${fmtDegC(v)} per reading`) : k === CFG.VOLTAGE ? `${v} V` : fmtLimit(v);

export class RackSentinelController {
  private s: ControllerState = initialState();
  private notes: Note[] = [];

  /** Power-on reset (_start / _boot_clear and the six cfg_set calls). */
  reset(): void {
    this.s = initialState();
  }

  get state(): Readonly<ControllerState> {
    return this.s;
  }

  snapshot(): ControllerState {
    return { ...this.s, cfg: [...this.s.cfg] };
  }

  get pins(): number {
    return this.s.pins;
  }

  /** Energy in Wh, as ENERGY would report it. */
  get energyWh(): number {
    return energyWh(this.s.energy);
  }

  private note(kind: NoteKind, text: string) {
    this.notes.push({ kind, text });
  }

  private take(): Note[] {
    const n = this.notes;
    this.notes = [];
    return n;
  }

  // ---------------------------------------------------------------- ECC (cfg_get / cfg_set)
  /** Read a protected word through ECC, every time it is used (cfg_get). */
  private cfgGet(k: number): { v: number; st: EccStatus } {
    const s = this.s;
    const d = eccDecode(s.cfg[k]);
    if (d.status === 1) {
      s.eccCorrected = sat(s.eccCorrected);
      s.cfg[k] = eccEncode(d.value); // scrub
      this.note("fix", `${CFG_NAMES[k]}: one flipped bit corrected and rewritten (ECC corrected = ${s.eccCorrected})`);
      return { v: d.value, st: 1 };
    }
    if (d.status === 2) {
      if (k < 6 && !(s.fault & (1 << k))) {
        s.fault |= 1 << k;
        s.eccUncorrectable = sat(s.eccUncorrectable);
        this.note("bad", `${CFG_NAMES[k]}: two flipped bits, cannot be repaired. Marked unreadable, read as 0 (uncorrectable = ${s.eccUncorrectable})`);
      } else if (k < 6) {
        this.note("bad", `${CFG_NAMES[k]} is still unreadable (read as 0)`);
      }
      return { v: 0, st: 2 };
    }
    return { v: d.value, st: 0 };
  }

  private cfgSet(k: number, v: number): void {
    this.s.cfg[k] = eccEncode(v & 0xff);
    this.s.fault &= ~(1 << k);
  }

  // ---------------------------------------------------------------- outputs and the latch
  private updateOutputs(): void {
    this.s.pins = computePins(this.s);
  }

  /** epo_trip: drive P7 first, then count and write the trip record (first cause only). */
  private epoTrip(cause: number): void {
    const s = this.s;
    if (s.epo) {
      this.note("info", "Power-off already latched; the record of the first trip is kept");
      return;
    }
    s.epo = true;
    s.pins |= PIN.EPO;
    s.epoTrips = sat(s.epoTrips);
    this.cfgSet(CFG.TRIP_CAUSE, cause);
    this.cfgSet(CFG.TRIP_TEMP, s.latestTemp);
    this.cfgSet(CFG.TRIP_CURRENT, s.latestCurrent);
    this.note("trip", `EMERGENCY POWER-OFF latched. Cause: ${causeText(cause)}. Trip record saved (trip ${s.epoTrips})`);
  }

  // ---------------------------------------------------------------- GPIO inputs (check_inputs)
  /** Present input levels and run one poll of check_inputs (leak first, then the reset button). */
  setInputs(levels: { reset?: boolean; leak?: boolean }): PollResult {
    const s = this.s;
    if (levels.reset !== undefined) s.inputs = levels.reset ? s.inputs | INPUT.RESET : s.inputs & ~INPUT.RESET;
    if (levels.leak !== undefined) s.inputs = levels.leak ? s.inputs | INPUT.LEAK : s.inputs & ~INPUT.LEAK;
    return this.poll();
  }

  setP0(level: boolean): PollResult {
    return this.setInputs({ reset: level });
  }

  setLeak(wet: boolean): PollResult {
    return this.setInputs({ leak: wet });
  }

  /** One pass of check_inputs. The firmware runs it continuously while waiting for a packet. */
  poll(): PollResult {
    const s = this.s;
    let leakTrip = false;
    if (s.inputs & INPUT.LEAK && !s.epo) {
      this.note("warn", "Leak sensor P1 is wet");
      this.epoTrip(CAUSE.LEAK);
      this.updateOutputs();
      leakTrip = true;
    }
    const b = !!(s.inputs & INPUT.RESET);
    const prev = s.btnPrev;
    s.btnPrev = b;
    if (!b) return { leakTrip, reset: null, newPress: false, notes: this.take() };
    if (prev) {
      this.note("info", "Reset button still held: only a new press counts");
      return { leakTrip, reset: "held", newPress: false, notes: this.take() };
    }
    if (!s.epo) {
      this.note("info", "Reset pressed: nothing to reset");
      return { leakTrip, reset: "not-latched", newPress: true, notes: this.take() };
    }
    const blockers = resetBlockers(s, false);
    if (blockers.length) {
      this.note("warn", `Reset REFUSED: ${blockers.map((b) => BLOCKER_REASON[b]).join(" and ")}`);
      return { leakTrip, reset: blockers[0], newPress: true, notes: this.take() };
    }
    s.epo = false;
    this.updateOutputs();
    this.note("fix", "Reset accepted: every cause is gone. Power-off cleared");
    return { leakTrip, reset: "accepted", newPress: true, notes: this.take() };
  }

  // ---------------------------------------------------------------- UART packets
  /** Handle one complete 4-byte packet (main_loop after the third rx_byte_timeout). */
  receiveFrame(frame: ArrayLike<number>): FrameResult {
    const f = Array.from(frame, (b) => b & 0xff);
    const [cmd, data, crcLo, crcHi] = f;
    const reply = this.exec(cmd, data, crcLo | (crcHi << 8));
    const outcome: FrameOutcome =
      reply.length > 1 ? "data" : reply[0] === REPLY.OK ? "accepted" : reply[0] === REPLY.BAD_CRC ? "bad-crc" : "invalid";
    return { frame: f, command: cmd, outcome, reply, notes: this.take() };
  }

  private invalid(why: string): number[] {
    this.note("warn", `Rejected: ${why}. Nothing changed`);
    return [REPLY.INVALID];
  }

  private setThreshold(k: number, d: number): number[] {
    if (d === 0 || d === 255) return this.invalid(`value ${d} is reserved`);
    const w = k === CFG.WARM ? d : this.cfgGet(CFG.WARM).v;
    const h = k === CFG.HOT ? d : this.cfgGet(CFG.HOT).v;
    const c = k === CFG.CRIT ? d : this.cfgGet(CFG.CRIT).v;
    if (w >= h || h >= c) return this.invalid(`the order Warm < Hot < Critical would break (${fmtDegC(w)} / ${fmtDegC(h)} / ${fmtDegC(c)})`);
    this.cfgSet(k, d);
    this.note("info", `${CFG_NAMES[k]} is now ${fmtDegC(d)}, stored with its error-correcting code`);
    return [REPLY.OK];
  }

  private exec(cmd: number, d: number, crc: number): number[] {
    const s = this.s;
    const expect = crc16([cmd, d]);
    if (expect !== crc) {
      s.crcRejects = sat(s.crcRejects);
      this.note("bad", `CRC computed by crcb (0x${expect.toString(16).toUpperCase().padStart(4, "0")}) differs from the CRC received (0x${crc.toString(16).toUpperCase().padStart(4, "0")}): packet ignored (CRC rejects = ${s.crcRejects})`);
      return [REPLY.BAD_CRC];
    }
    switch (cmd) {
      case CMD.TEMP: {
        if (d === 0) return this.invalid("raw 0 is reserved (no reading)");
        if (d === 255) return this.invalid("raw 255 is reserved (sensor fault)");
        const w = this.cfgGet(CFG.WARM).v, h = this.cfgGet(CFG.HOT).v, c = this.cfgGet(CFG.CRIT).v, r = this.cfgGet(CFG.RISE).v;
        const was = s.tempClass;
        s.tempClass = d < w ? TEMP_CLASS.NORMAL : d < h ? TEMP_CLASS.WARM : d < c ? TEMP_CLASS.HOT : TEMP_CLASS.CRITICAL;
        this.note("info", `${fmtDegC(d)} is ${CLASS_NAME[s.tempClass]}${s.gotTemp && was !== s.tempClass ? ` (was ${CLASS_NAME[was]})` : ""}`);
        s.rapid = false;
        if (s.latestTemp !== 0 && r !== 0) {
          if (d - s.latestTemp >= r) {
            s.rapid = true;
            this.note("warn", `Rose ${fmtDegC(d - s.latestTemp)} since the last reading (limit ${fmtDegC(r)}): THERMAL RUNAWAY, cooling has failed`);
          } else if (d > s.latestTemp) {
            this.note("info", `Rose ${fmtDegC(d - s.latestTemp)}: below the runaway limit of ${fmtDegC(r)}`);
          }
        }
        s.latestTemp = d;
        s.gotTemp = true;
        const cause =
          (s.tempClass === TEMP_CLASS.CRITICAL ? CAUSE.CRITICAL : 0) | (s.rapid ? CAUSE.RUNAWAY : 0) | (s.fault & SETTINGS_MASK ? CAUSE.CONFIG : 0);
        if (cause) {
          if (cause & CAUSE.CONFIG) this.note("bad", "A safety setting cannot be trusted, so the chip fails safe instead of guessing");
          this.epoTrip(cause);
        }
        this.updateOutputs();
        return [REPLY.OK];
      }
      case CMD.CURRENT: {
        if (d === 255) return this.invalid("raw 255 is reserved (sensor fault)");
        s.latestCurrent = d;
        s.gotCurrent = true;
        const v = this.cfgGet(CFG.VOLTAGE).v, lim = this.cfgGet(CFG.POWER_LIMIT).v;
        const p = d * v; // mul
        let e = (s.energy + p) >>> 0;
        if (e < s.energy) e = 0xffffffff;
        s.energy = e;
        s.power = p;
        s.overload = p >= lim * 500;
        this.note(s.overload ? "warn" : "info", `Power = ${v} V × ${fmtAmps(d)} = ${fmtKW(p)}; limit ${fmtKW(lim * 500)}${s.overload ? ": OVERLOAD" : ""}`);
        if (s.fault & SETTINGS_MASK) {
          this.note("bad", "A safety setting cannot be trusted, so the chip fails safe instead of guessing");
          this.epoTrip(CAUSE.CONFIG);
        }
        this.updateOutputs();
        return [REPLY.OK];
      }
      case CMD.FLIP_TEST: {
        if (d & 0xe0) return this.invalid("bits 7:5 must be 0");
        const k = d & 0x0f;
        if (k > 8) return this.invalid(`there is no protected word ${k}`);
        s.cfg[k] = (s.cfg[k] ^ (d & 0x10 ? FLIP_TWO : FLIP_ONE)) & ((1 << ECC_WIDTH) - 1);
        this.note("warn", `Self-test: ${d & 0x10 ? "TWO bits" : "ONE bit"} of "${CFG_NAMES[k]}" flipped in memory`);
        return [REPLY.OK];
      }
      case CMD.SET_WARM:
        return this.setThreshold(CFG.WARM, d);
      case CMD.SET_HOT:
        return this.setThreshold(CFG.HOT, d);
      case CMD.SET_CRIT:
        return this.setThreshold(CFG.CRIT, d);
      case CMD.SET_RISE:
        this.cfgSet(CFG.RISE, d);
        this.note("info", d === 0 ? "Runaway detection is now off" : `Runaway limit is now ${fmtDegC(d)} per reading`);
        return [REPLY.OK];
      case CMD.SET_VOLTAGE:
        if (d < 180 || d === 255) return this.invalid("the voltage must be 180 to 254 V");
        this.cfgSet(CFG.VOLTAGE, d);
        this.note("info", `Supply voltage is now ${d} V`);
        return [REPLY.OK];
      case CMD.SET_POWER_LIMIT:
        if (d === 0 || d === 255) return this.invalid("the power limit must be 1 to 254 (× 100 W)");
        this.cfgSet(CFG.POWER_LIMIT, d);
        this.note("info", `Power limit is now ${fmtLimit(d)}`);
        return [REPLY.OK];
      case CMD.STATUS:
        if (d !== 0) return this.invalid("STATUS takes the value 0");
        return [statusFlags(s), s.latestTemp & 0xff, s.latestCurrent & 0xff, s.epoTrips & 0xff];
      case CMD.ENERGY: {
        if (d !== 0) return this.invalid("ENERGY takes the value 0");
        const wh = energyWh(s.energy);
        this.note("info", `Wh = stored energy ÷ 300, done as mulhu and a shift (no divider): ${wh} Wh`);
        return [wh & 0xff, (wh >>> 8) & 0xff, (wh >>> 16) & 0xff, (wh >>> 24) & 0xff];
      }
      case CMD.COUNTERS:
        if (d !== 0) return this.invalid("COUNTERS takes the value 0");
        return [s.crcRejects, s.eccCorrected, s.eccUncorrectable, 0];
      case CMD.TRIP_INFO: {
        if (d !== 0) return this.invalid("TRIP_INFO takes the value 0");
        const out: number[] = [];
        for (let k = CFG.TRIP_CAUSE; k <= CFG.TRIP_CURRENT; k++) {
          const g = this.cfgGet(k);
          out.push(g.st === 2 ? 0xff : g.v);
        }
        out.push(s.epoTrips);
        return out;
      }
    }
    return this.invalid(`0x${cmd.toString(16).toUpperCase().padStart(2, "0")} is not a command`);
  }
}

export const BLOCKER_REASON: Record<ResetOutcome, string> = {
  leak: "the leak sensor is still wet",
  "temperature-critical": "the temperature is still Critical",
  runaway: "the latest reading was a thermal runaway",
  "config-fault": "a safety setting is still unreadable",
  held: "P0 is held down",
  "not-latched": "nothing is latched",
  accepted: "",
  released: "",
};

export { settingText };
