/**
 * Incident record: the event timeline and the causality chains the HUD replays.
 *
 * Both are derived from controller state before and after each packet or input poll, so they
 * can only describe what the controller model actually did. Pure functions; the runtime calls them.
 */
import { CFG, CLASS_NAME, SETTINGS_MASK, TEMP_CLASS, settingsView, type ControllerState, type FrameResult, type ResetOutcome } from "./controller";
import type { NoticeTone, TelemetryKind } from "./events";
import { CMD, CMD_NAME, INPUT, PIN, REPLY, causeText, hex, hexBytes } from "./protocol";
import { energyWh, fmtAmps, fmtDegC, fmtKW, fmtLimit } from "./units";

export { CLASS_NAME };

/** What the camera should look at for an event. */
export type FocusTarget = "rack" | "desk" | "button" | "room";

/** Controller state reduced to what an event needs to show. */
export interface StateDigest {
  /** Raw readings (0.5 °C / 0.2 A steps), null before the first valid reading. */
  temp: number | null;
  current: number | null;
  tempClass: number;
  pins: number;
  epo: boolean;
  p0: boolean;
  leak: boolean;
  rapid: boolean;
  fault: boolean;
}

export type TimelineKind = "scenario" | "telemetry" | "command" | "query" | "validation" | "class" | "output" | "ecc" | "epo" | "leak" | "link" | "reset";

export interface TimelineEntry {
  id: number;
  /** Simulation time (ms). */
  at: number;
  kind: TimelineKind;
  title: string;
  detail?: string;
  tone: NoticeTone;
  focus: FocusTarget;
  values: StateDigest;
  /** Frame bytes and reply for packet events. */
  frame?: number[];
  reply?: number[];
  reset?: ResetOutcome;
}

export interface CauseNode {
  label: string;
  tone: NoticeTone;
}

/** One controller decision, input to result, plus the state just before and after it. */
export interface CauseChain {
  id: number;
  at: number;
  kind: "telemetry" | "reset" | "leak";
  nodes: CauseNode[];
  before: StateDigest;
  after: StateDigest;
}

export function digest(s: ControllerState, p0: boolean): StateDigest {
  return {
    temp: s.gotTemp ? s.latestTemp : null,
    current: s.gotCurrent ? s.latestCurrent : null,
    tempClass: s.tempClass,
    pins: s.pins,
    epo: s.epo,
    p0,
    leak: !!(s.inputs & INPUT.LEAK),
    rapid: s.rapid,
    fault: !!(s.fault & SETTINGS_MASK),
  };
}

const PIN_TEXT: { bit: number; on: string; off: string; tone: NoticeTone }[] = [
  { bit: PIN.FAN_BOOST, on: "P4 fan boost", off: "P4 fan boost off", tone: "warn" },
  { bit: PIN.FAN_MAX, on: "P5 fans at maximum", off: "P5 fans at maximum off", tone: "warn" },
  { bit: PIN.OVERLOAD, on: "P6 overload alarm", off: "P6 overload alarm off", tone: "warn" },
];

export const classTone = (c: number): NoticeTone => (c === TEMP_CLASS.CRITICAL ? "alarm" : c >= TEMP_CLASS.WARM ? "warn" : "ok");

/** What a packet carries, in words: "TEMP 35.0 °C", "SET_VOLTAGE 240 V", "STATUS". */
export function packetText(cmd: number, data: number): string {
  const n = CMD_NAME[cmd] ?? `0x${hex(cmd)}`;
  switch (cmd) {
    case CMD.TEMP:
    case CMD.SET_WARM:
    case CMD.SET_HOT:
    case CMD.SET_CRIT:
      return `${n} ${fmtDegC(data)}`;
    case CMD.CURRENT:
      return `${n} ${fmtAmps(data)}`;
    case CMD.SET_RISE:
      return `${n} ${data === 0 ? "off" : fmtDegC(data)}`;
    case CMD.SET_VOLTAGE:
      return `${n} ${data} V`;
    case CMD.SET_POWER_LIMIT:
      return `${n} ${fmtLimit(data)}`;
    case CMD.FLIP_TEST:
      return `${n} word ${data & 0x0f}, ${data & 0x10 ? "2 bits" : "1 bit"}`;
    default:
      return n;
  }
}

/** A query reply in words. */
export function replyText(cmd: number, b: number[]): string {
  switch (cmd) {
    case CMD.STATUS:
      return `${CLASS_NAME[b[0] & 3]}${b[0] & 0x08 ? ", power-off latched" : ""}, ${b[1] ? fmtDegC(b[1]) : "no reading"}, ${fmtAmps(b[2])}, ${b[3]} trip${b[3] === 1 ? "" : "s"}`;
    case CMD.ENERGY:
      return `${(b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0} Wh`;
    case CMD.COUNTERS:
      return `${b[0]} CRC rejects, ${b[1]} corrected, ${b[2]} uncorrectable`;
    case CMD.TRIP_INFO:
      return b[0] === 0 && b[3] === 0 ? "no trip yet" : `${b[0] === 0xff ? "cause unreadable" : causeText(b[0])} at ${b[1] === 0xff ? "?" : fmtDegC(b[1])}, ${b[2] === 0xff ? "?" : fmtAmps(b[2])}`;
    default:
      return hexBytes(b);
  }
}

const tripCause = (a: ControllerState) => settingsView(a)[CFG.TRIP_CAUSE].value;

/** Causality chain for one packet. Returns null for a reading that changed nothing. */
export function telemetryChain(kind: TelemetryKind, r: FrameResult, b: ControllerState, a: ControllerState): CauseNode[] | null {
  const code = r.reply[0];
  const head = { label: packetText(r.command, r.frame[1]), tone: "info" as NoticeTone };
  if (r.outcome === "bad-crc") {
    return [{ label: "Packet received", tone: "info" }, { label: "CRC check failed", tone: "warn" }, { label: `Reply 0x${hex(code ?? REPLY.BAD_CRC)}`, tone: "warn" }, { label: "State unchanged", tone: "info" }];
  }
  if (r.outcome === "invalid") {
    return [head, { label: "CRC accepted", tone: "ok" }, { label: kind === "invalid" ? "Raw 0: no reading" : "Value rejected", tone: "warn" }, { label: `Reply 0x${hex(code ?? REPLY.INVALID)}`, tone: "warn" }, { label: "State unchanged", tone: "info" }];
  }
  if (r.outcome === "data") {
    return [head, { label: "CRC accepted", tone: "ok" }, { label: `Reply ${hexBytes(r.reply)}`, tone: "info" }, { label: replyText(r.command, r.reply), tone: "info" }];
  }
  if (r.command === CMD.FLIP_TEST) return [head, { label: "CRC accepted", tone: "ok" }, { label: "Bits flipped in memory", tone: "warn" }, { label: "Found at next use", tone: "info" }];
  if (r.command !== CMD.TEMP && r.command !== CMD.CURRENT) {
    const nodes: CauseNode[] = [head, { label: "CRC accepted", tone: "ok" }, { label: "Stored with ECC", tone: "ok" }];
    if ((b.fault & SETTINGS_MASK) && !(a.fault & SETTINGS_MASK)) nodes.push({ label: "Fault cleared", tone: "ok" });
    nodes.push({ label: "Reply 0xA5", tone: "ok" });
    return nodes;
  }

  const nodes: CauseNode[] = [head, { label: "CRC accepted", tone: "ok" }];
  let changed = false;
  if (a.eccCorrected > b.eccCorrected) {
    changed = true;
    nodes.push({ label: "ECC repaired a setting", tone: "ok" });
  }
  if ((a.fault & SETTINGS_MASK) && !(b.fault & SETTINGS_MASK)) {
    changed = true;
    nodes.push({ label: "Setting unreadable", tone: "alarm" });
  }
  if (r.command === CMD.TEMP) {
    if (a.tempClass !== b.tempClass || !b.gotTemp) {
      changed = changed || a.tempClass !== b.tempClass;
      nodes.push({ label: `${CLASS_NAME[a.tempClass]} temperature`, tone: classTone(a.tempClass) });
    }
    if (a.rapid && !b.rapid) {
      changed = true;
      nodes.push({ label: `Runaway +${fmtDegC(a.latestTemp - b.latestTemp)}`, tone: "alarm" });
    }
  } else {
    if (a.overload !== b.overload || !b.gotCurrent) {
      changed = changed || a.overload !== b.overload;
      nodes.push({ label: `${fmtKW(a.power ?? 0)}${a.overload ? " · over the limit" : ""}`, tone: a.overload ? "warn" : "ok" });
    }
  }
  for (const p of PIN_TEXT) {
    const on = !!(a.pins & p.bit), was = !!(b.pins & p.bit);
    if (on === was) continue;
    changed = true;
    nodes.push({ label: on ? p.on : p.off, tone: on ? p.tone : "info" });
  }
  if (a.epo && !b.epo) {
    changed = true;
    nodes.push({ label: `P7 power-off · ${causeText(tripCause(a))}`, tone: "alarm" });
  } else if (a.epo && changed) {
    nodes.push({ label: "P7 remains latched", tone: "warn" });
  }
  if (changed) return nodes;
  const moved = r.command === CMD.TEMP ? b.latestTemp !== a.latestTemp || !b.gotTemp : b.latestCurrent !== a.latestCurrent || !b.gotCurrent;
  if (!moved) return null;
  if (r.command === CMD.CURRENT && b.gotCurrent) return null; // a current step that changes no decision is not worth a ribbon
  if (r.command === CMD.TEMP && b.gotTemp) {
    nodes.push({ label: `Still ${CLASS_NAME[a.tempClass]}`, tone: classTone(a.tempClass) });
  }
  nodes.push({ label: a.epo ? "Outputs unchanged · P7 latched" : a.pins ? "Outputs unchanged" : "No outputs requested", tone: a.epo ? "warn" : "info" });
  return nodes;
}

/** Causality chain for a leak sensor change. */
export function leakChain(wet: boolean, tripped: boolean, a: ControllerState): CauseNode[] | null {
  if (wet && tripped) {
    return [
      { label: "P1 leak sensor wet", tone: "alarm" },
      { label: "Seen by check_inputs", tone: "info" },
      { label: "No UART message needed", tone: "info" },
      { label: "P7 power-off · water leak", tone: "alarm" },
    ];
  }
  if (!wet) {
    return [
      { label: "P1 leak sensor dry", tone: "info" },
      { label: a.epo ? "P7 remains latched" : "Nothing latched", tone: a.epo ? "warn" : "ok" },
    ];
  }
  return null;
}

/** Causality chain for one P0 evaluation. */
export function resetChain(outcome: ResetOutcome, a: ControllerState): CauseNode[] | null {
  const refused = (why: string, tone: NoticeTone): CauseNode[] => [
    { label: "New P0 press", tone: "info" },
    { label: why, tone },
    { label: "Reset refused", tone: "warn" },
    { label: "P7 remains latched", tone: "alarm" },
  ];
  switch (outcome) {
    case "accepted":
      return [
        { label: "New P0 press", tone: "info" },
        { label: `${fmtDegC(a.latestTemp)} ${CLASS_NAME[a.tempClass]} · no runaway · dry · settings OK`, tone: "ok" },
        { label: "Reset accepted", tone: "ok" },
        { label: "P7 power-off cleared", tone: "ok" },
      ];
    case "temperature-critical":
      return refused(`Temperature Critical · ${fmtDegC(a.latestTemp)}`, "alarm");
    case "leak":
      return refused("Leak sensor still wet", "alarm");
    case "runaway":
      return refused("Latest reading was a runaway", "warn");
    case "config-fault":
      return refused("A setting is unreadable", "warn");
    case "held":
      return [
        { label: "P0 already held", tone: "info" },
        { label: "No new press edge", tone: "warn" },
        { label: "Reset refused", tone: "warn" },
        { label: "P7 remains latched", tone: "alarm" },
      ];
    default:
      return null;
  }
}

/** Timeline entries for one packet (without ids or time; the runtime stamps them). */
export function telemetryEntries(kind: TelemetryKind, r: FrameResult, b: ControllerState, a: ControllerState, recovery: boolean): Omit<TimelineEntry, "id" | "at" | "values">[] {
  const frame = r.frame, reply = r.reply;
  if (r.outcome === "bad-crc") {
    return [{ kind: "validation", title: "Bad CRC · reply 0x5A", detail: `Frame ${hexBytes(frame)}. Ignored, reject counter ${a.crcRejects}.`, tone: "warn", focus: "desk", frame, reply }];
  }
  if (r.outcome === "invalid") {
    return [{ kind: "validation", title: `${packetText(r.command, frame[1])} rejected · reply 0x3C`, detail: `Frame ${hexBytes(frame)}. Nothing changed.`, tone: "warn", focus: "desk", frame, reply }];
  }
  if (r.outcome === "data") {
    return [{ kind: "query", title: `${CMD_NAME[r.command]} → ${hexBytes(reply)}`, detail: replyText(r.command, reply), tone: "info", focus: "desk", frame, reply }];
  }
  const out: Omit<TimelineEntry, "id" | "at" | "values">[] = [];
  if (r.command !== CMD.TEMP && r.command !== CMD.CURRENT) {
    out.push({ kind: "command", title: `${packetText(r.command, frame[1])} · reply 0xA5`, detail: `Frame ${hexBytes(frame)}`, tone: r.command === CMD.FLIP_TEST ? "warn" : "info", focus: "desk", frame, reply });
    return out;
  }
  const meaningful = recovery || telemetryChain(kind, r, b, a) !== null;
  if (meaningful) {
    out.push({
      kind: "telemetry",
      title: `${recovery ? "Recovery reading" : "Reading"} ${packetText(r.command, frame[1])}`,
      detail: `CRC accepted · reply 0xA5 · frame ${hexBytes(frame)}`,
      tone: "info",
      focus: "desk",
      frame,
      reply,
    });
  }
  if (a.eccCorrected > b.eccCorrected) out.push({ kind: "ecc", title: "ECC corrected one flipped bit", detail: "Setting repaired and written back.", tone: "ok", focus: "rack" });
  if ((a.fault & SETTINGS_MASK) && !(b.fault & SETTINGS_MASK)) out.push({ kind: "ecc", title: "Setting unreadable (2-bit error)", detail: "Read as 0; the chip fails safe.", tone: "alarm", focus: "rack" });
  if (a.tempClass !== b.tempClass) {
    out.push({ kind: "class", title: `Temperature ${CLASS_NAME[b.tempClass]} → ${CLASS_NAME[a.tempClass]}`, detail: fmtDegC(a.latestTemp), tone: classTone(a.tempClass), focus: "rack" });
  }
  for (const p of PIN_TEXT) {
    const on = !!(a.pins & p.bit), was = !!(b.pins & p.bit);
    if (on !== was) out.push({ kind: "output", title: on ? `${p.on} on` : p.off, tone: on ? p.tone : "info", focus: "rack" });
  }
  if (a.epo && !b.epo) {
    out.push({ kind: "epo", title: "P7 power-off latched", detail: `Cause: ${causeText(tripCause(a))}. Trip ${a.epoTrips}.`, tone: "alarm", focus: "rack" });
  }
  return out;
}

export const RESET_ENTRY: Partial<Record<ResetOutcome, { title: string; tone: NoticeTone }>> = {
  accepted: { title: "P0 accepted · power-off cleared", tone: "ok" },
  "temperature-critical": { title: "P0 refused · temperature Critical", tone: "alarm" },
  leak: { title: "P0 refused · leak sensor wet", tone: "alarm" },
  runaway: { title: "P0 refused · runaway on the latest reading", tone: "warn" },
  "config-fault": { title: "P0 refused · setting unreadable", tone: "warn" },
  held: { title: "P0 refused · button held", tone: "warn" },
  "not-latched": { title: "P0 pressed · nothing latched", tone: "info" },
};

/** Energy as ENERGY would report it, for summaries. */
export const whOf = (s: ControllerState) => energyWh(s.energy);
