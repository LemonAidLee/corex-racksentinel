/**
 * RackSentinel controller model.
 *
 * A deterministic, byte-level port of Equipe31_Submission_Files/firmware/firmware_application/main.s.
 * Every decision below has a matching label in the firmware; comments name it.
 * No rendering or UI code lives here.
 */
import { crc16 } from "./crc";
import { CMD, PIN, REPLY, STATUS_FLAG } from "./protocol";

/** Temperature class encoding used by the firmware (ST_CLASS) and the STATUS flags. */
export const TEMP_CLASS = { NORMAL: 0, WARM: 1, CRITICAL: 3 } as const;
export type TempClass = (typeof TEMP_CLASS)[keyof typeof TEMP_CLASS];

/** Firmware defaults (DEF_* constants). Temperature thresholds are in tenths of °C. */
export const DEFAULTS = {
  warmTenths: 0x10e, // 270 → 27.0 °C
  critTenths: 0x140, // 320 → 32.0 °C
  voltageRaw: 230,
  warnCurrentRaw: 128, // 25.6 A
  tripCurrentRaw: 160, // 32.0 A
} as const;

export interface ControllerState {
  thrWarm: number;
  thrCrit: number;
  voltage: number;
  warnCurrent: number;
  tripCurrent: number;
  stage: number;
  stagePending: boolean;
  latestTemp: number;
  gotTemp: boolean;
  tempClass: TempClass;
  latestCurrent: number;
  gotCurrent: boolean;
  overload: boolean;
  epo: boolean;
  epoTrips: number;
  crcRejects: number;
  btnPrev: boolean;
  /** GPIO output byte; P7..P4 live in the upper nibble. */
  pins: number;
}

export type FrameOutcome = "accepted" | "invalid" | "bad-crc" | "status" | "counters" | "timeout";

export interface FrameResult {
  frame: number[];
  outcome: FrameOutcome;
  /** Bytes the controller sends back (empty on timeout). */
  reply: number[];
  /** Command byte of the frame. */
  command: number;
}

export type ResetOutcome =
  | "accepted"
  | "not-latched"
  | "temperature-warm"
  | "temperature-critical"
  | "current-warning"
  | "held"
  | "released";

export interface ResetAttempt {
  /** True when this poll saw a new 0→1 transition on P0. */
  newPress: boolean;
  outcome: ResetOutcome;
}

function initialState(): ControllerState {
  return {
    thrWarm: DEFAULTS.warmTenths,
    thrCrit: DEFAULTS.critTenths,
    voltage: DEFAULTS.voltageRaw,
    warnCurrent: DEFAULTS.warnCurrentRaw,
    tripCurrent: DEFAULTS.tripCurrentRaw,
    stage: 0,
    stagePending: false,
    latestTemp: 0,
    gotTemp: false,
    tempClass: TEMP_CLASS.NORMAL,
    latestCurrent: 0,
    gotCurrent: false,
    overload: false,
    epo: false,
    epoTrips: 0,
    crcRejects: 0,
    btnPrev: false,
    pins: 0,
  };
}

/** Pure classification of a temperature reading against tenth-of-degree thresholds. */
export function classifyTemperature(tempRaw: number, warmTenths: number = DEFAULTS.warmTenths, critTenths: number = DEFAULTS.critTenths): TempClass {
  const tenths = tempRaw * 5; // `mul` by 5: 0.5 °C steps → tenths of °C
  if (tenths < warmTenths) return TEMP_CLASS.NORMAL; // blt t1, t0
  if (critTenths >= tenths) return TEMP_CLASS.WARM; // bge t0, t1 → Warm includes exactly the critical threshold
  return TEMP_CLASS.CRITICAL;
}

/** Validation rules for a SAMPLE (cmd_sample_process). */
export function sampleIsValid(voltRaw: number, currentRaw: number, tempRaw: number): boolean {
  if (voltRaw < 180 || voltRaw === 255) return false;
  if (currentRaw === 255) return false;
  if (tempRaw === 0 || tempRaw === 255) return false;
  return true;
}

/** Output byte from the state (update_outputs). */
export function computePins(s: Pick<ControllerState, "tempClass" | "overload" | "epo">): number {
  let p = 0;
  if (s.tempClass === TEMP_CLASS.WARM) p = PIN.FAN_BOOST;
  else if (s.tempClass === TEMP_CLASS.CRITICAL) p = PIN.FAN_MAX;
  if (s.overload) p |= PIN.CURRENT_WARNING;
  if (s.epo) p |= PIN.EPO_REQUEST;
  return p;
}

/**
 * Everything currently preventing a P0 press from clearing the EPO, in firmware check order.
 * Empty when a new press would be accepted. `p0Held` is the current button level.
 */
export function resetBlockers(s: ControllerState, p0Held: boolean): ResetOutcome[] {
  if (!s.epo) return ["not-latched"];
  const out: ResetOutcome[] = [];
  if (p0Held) out.push("held");
  if (s.tempClass === TEMP_CLASS.CRITICAL) out.push("temperature-critical");
  else if (s.tempClass === TEMP_CLASS.WARM) out.push("temperature-warm");
  if (s.latestCurrent >= s.warnCurrent) out.push("current-warning");
  return out;
}

export class RackSentinelController {
  private s: ControllerState = initialState();

  /** Power-on reset (_start / _boot_clear). */
  reset(): void {
    this.s = initialState();
  }

  get state(): Readonly<ControllerState> {
    return this.s;
  }

  snapshot(): ControllerState {
    return { ...this.s };
  }

  get pins(): number {
    return this.s.pins;
  }

  /**
   * Feed a byte stream to the UART receiver. Frames are split exactly like main_loop:
   * a leading 0x5A means a 6-byte SAMPLE, anything else a 4-byte command. A frame that
   * runs out of bytes is dropped by the receive timeout with no reply.
   */
  receiveBytes(bytes: ArrayLike<number>): FrameResult[] {
    const results: FrameResult[] = [];
    let i = 0;
    while (i < bytes.length) {
      const command = bytes[i] & 0xff;
      const len = command === CMD.SAMPLE ? 6 : 4;
      const frame = Array.from({ length: Math.min(len, bytes.length - i) }, (_, k) => bytes[i + k] & 0xff);
      i += frame.length;
      if (frame.length < len) {
        results.push({ frame, outcome: "timeout", reply: [], command });
        break;
      }
      results.push(command === CMD.SAMPLE ? this.handleSample(frame) : this.handleCommand(frame));
    }
    return results;
  }

  /** Convenience for exactly one complete frame. */
  receiveFrame(frame: ArrayLike<number>): FrameResult {
    return this.receiveBytes(frame)[0];
  }

  /**
   * Present a level on P0 and run one poll of check_reset.
   * The firmware polls continuously while idle, so one call per level change is equivalent.
   */
  setP0(level: boolean): ResetAttempt {
    const s = this.s;
    const prev = s.btnPrev;
    s.btnPrev = level; // sw a4, ST_BTN_PREV
    if (!level) return { newPress: false, outcome: "released" };
    if (prev) return { newPress: false, outcome: "held" }; // still held: not a new press
    if (!s.epo) return { newPress: true, outcome: "not-latched" };
    if (s.tempClass === TEMP_CLASS.CRITICAL) return { newPress: true, outcome: "temperature-critical" };
    if (s.tempClass !== TEMP_CLASS.NORMAL) return { newPress: true, outcome: "temperature-warm" };
    if (s.latestCurrent >= s.warnCurrent) return { newPress: true, outcome: "current-warning" };
    s.epo = false;
    this.updateOutputs();
    return { newPress: true, outcome: "accepted" };
  }

  private reply(frame: number[], outcome: FrameOutcome, reply: number[]): FrameResult {
    return { frame, outcome, reply, command: frame[0] };
  }

  private badCrc(frame: number[]): FrameResult {
    if (this.s.crcRejects < 255) this.s.crcRejects++;
    return this.reply(frame, "bad-crc", [REPLY.BAD_CRC]);
  }

  private handleSample(frame: number[]): FrameResult {
    const [, v, i, t, crcLo, crcHi] = frame;
    if (crc16(frame.slice(0, 4)) !== (crcLo | (crcHi << 8))) return this.badCrc(frame);
    if (!sampleIsValid(v, i, t)) return this.reply(frame, "invalid", [REPLY.INVALID]);

    const s = this.s;
    s.voltage = v; // validated and stored only; never used for protection
    s.latestCurrent = i;
    s.gotCurrent = true;
    s.overload = i >= s.warnCurrent; // sltu + xori
    s.tempClass = classifyTemperature(t, s.thrWarm, s.thrCrit);
    s.latestTemp = t;
    s.gotTemp = true;

    const trip = s.tripCurrent < i || s.tempClass === TEMP_CLASS.CRITICAL;
    if (trip && !s.epo) {
      // _sm_trip_epo: count only the transition into the latched state
      s.epo = true;
      if (s.epoTrips < 255) s.epoTrips++;
    }
    this.updateOutputs();
    return this.reply(frame, "accepted", [REPLY.OK]);
  }

  private handleCommand(frame: number[]): FrameResult {
    const [cmd, data, crcLo, crcHi] = frame;
    if (crc16([cmd, data]) !== (crcLo | (crcHi << 8))) return this.badCrc(frame);
    const s = this.s;
    const ok = () => this.reply(frame, "accepted", [REPLY.OK]);
    const invalid = () => this.reply(frame, "invalid", [REPLY.INVALID]);

    switch (cmd) {
      case CMD.STAGE_HIGH:
        s.stage = data << 8;
        s.stagePending = true;
        return ok();
      case CMD.SET_WARM:
      case CMD.SET_CRIT: {
        const pending = s.stagePending;
        s.stagePending = false; // cleared even if the command is then rejected
        if (!pending) return invalid();
        const value = s.stage | data;
        const warm = cmd === CMD.SET_WARM ? value : s.thrWarm;
        const crit = cmd === CMD.SET_CRIT ? value : s.thrCrit;
        if (warm >= crit) return invalid();
        if (cmd === CMD.SET_WARM) s.thrWarm = value;
        else s.thrCrit = value;
        return ok();
      }
      case CMD.SET_WARN_CURRENT:
        if (data === 0 || data >= s.tripCurrent) return invalid();
        s.warnCurrent = data;
        s.overload = s.latestCurrent >= data;
        this.updateOutputs();
        return ok();
      case CMD.SET_TRIP_CURRENT:
        if (data === 255 || s.warnCurrent >= data) return invalid();
        s.tripCurrent = data;
        return ok();
      case CMD.STATUS:
        if (data !== 0) return invalid();
        return this.reply(frame, "status", [this.statusFlags(), s.latestTemp & 0xff, s.latestCurrent & 0xff, s.epoTrips & 0xff]);
      case CMD.COUNTERS:
        if (data !== 0) return invalid();
        return this.reply(frame, "counters", [s.crcRejects & 0xff, 0, 0, 0]);
      default:
        return invalid(); // includes the removed 0x47 and 0x51
    }
  }

  statusFlags(): number {
    const s = this.s;
    return (
      (s.tempClass & STATUS_FLAG.CLASS_MASK) |
      (s.overload ? STATUS_FLAG.CURRENT_WARNING : 0) |
      (s.epo ? STATUS_FLAG.EPO_LATCHED : 0) |
      (s.gotTemp ? STATUS_FLAG.GOT_TEMPERATURE : 0) |
      (s.stagePending ? STATUS_FLAG.STAGE_PENDING : 0)
    );
  }

  private updateOutputs(): void {
    this.s.pins = computePins(this.s);
  }
}
