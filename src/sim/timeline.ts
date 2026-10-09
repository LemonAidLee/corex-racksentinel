/**
 * Incident record: the event timeline and the causality chains the HUD replays.
 *
 * Both are derived from controller state before and after each packet or P0 poll, so they can
 * only describe what the controller model actually did. Pure functions; the runtime calls them.
 */
import { TEMP_CLASS, type ControllerState, type FrameResult, type ResetOutcome } from "./controller";
import type { NoticeTone, TelemetryKind } from "./events";
import { PIN, REPLY, hex, hexBytes } from "./protocol";
import { fmtAmps, fmtDegC } from "./units";

/** What the camera should look at for an event. */
export type FocusTarget = "rack" | "desk" | "button" | "room";

/** Controller state reduced to what an event needs to show. */
export interface StateDigest {
  /** Raw readings (0.5 °C / 0.2 A steps), null before the first valid sample. */
  temp: number | null;
  current: number | null;
  tempClass: number;
  pins: number;
  epo: boolean;
  p0: boolean;
}

export type TimelineKind = "scenario" | "telemetry" | "validation" | "class" | "output" | "epo" | "link" | "reset";

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
  kind: "telemetry" | "reset";
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
  };
}

export const CLASS_NAME: Record<number, string> = { [TEMP_CLASS.NORMAL]: "Normal", [TEMP_CLASS.WARM]: "Warm", [TEMP_CLASS.CRITICAL]: "Critical" };

const PIN_TEXT: { bit: number; pin: string; on: string; off: string; tone: NoticeTone }[] = [
  { bit: PIN.FAN_BOOST, pin: "P4", on: "P4 fan boost", off: "P4 fan boost off", tone: "warn" },
  { bit: PIN.FAN_MAX, pin: "P5", on: "P5 maximum fan", off: "P5 maximum fan off", tone: "alarm" },
  { bit: PIN.CURRENT_WARNING, pin: "P6", on: "P6 current warning", off: "P6 current warning off", tone: "warn" },
];

const classTone = (c: number): NoticeTone => (c === TEMP_CLASS.CRITICAL ? "alarm" : c === TEMP_CLASS.WARM ? "warn" : "ok");

/** "32.5 °C · 25.4 A" for the reading a frame carried. */
function readingOf(frame: number[]): string {
  return `${fmtDegC(frame[3] ?? 0)} · ${fmtAmps(frame[2] ?? 0)}`;
}

/** Causality chain for one packet. Returns null for a valid sample that changed nothing. */
export function telemetryChain(kind: TelemetryKind, r: FrameResult, b: ControllerState, a: ControllerState): CauseNode[] | null {
  const code = r.reply[0];
  if (r.outcome === "bad-crc") {
    return [
      { label: "Packet received", tone: "info" },
      { label: "CRC check failed", tone: "warn" },
      { label: `Reply 0x${hex(code ?? REPLY.BAD_CRC)}`, tone: "warn" },
      { label: "Controller state unchanged", tone: "info" },
    ];
  }
  if (r.outcome === "invalid") {
    return [
      { label: "Packet received", tone: "info" },
      { label: kind === "invalid" ? "Temperature raw 0 · invalid" : "Validation failed", tone: "warn" },
      { label: `Reply 0x${hex(code ?? REPLY.INVALID)}`, tone: "warn" },
      { label: "Controller state unchanged", tone: "info" },
    ];
  }
  if (r.outcome !== "accepted") return null;

  const nodes: CauseNode[] = [
    { label: `${readingOf(r.frame)} telemetry`, tone: "info" },
    { label: "CRC accepted", tone: "ok" },
  ];
  const tripCurrent = a.latestCurrent > a.tripCurrent;
  const wasTrip = b.gotCurrent && b.latestCurrent > b.tripCurrent;
  let changed = false;
  if (a.tempClass !== b.tempClass || !b.gotTemp) {
    if (a.tempClass !== b.tempClass) changed = true;
    nodes.push({ label: `${CLASS_NAME[a.tempClass]} temperature`, tone: classTone(a.tempClass) });
  }
  if (tripCurrent && !wasTrip) {
    changed = true;
    nodes.push({ label: "Current above 32.0 A", tone: "alarm" });
  }
  for (const p of PIN_TEXT) {
    const on = !!(a.pins & p.bit), was = !!(b.pins & p.bit);
    if (on === was) continue;
    changed = true;
    nodes.push({ label: on ? p.on : p.off, tone: on ? p.tone : "info" });
  }
  if (a.epo && !b.epo) {
    changed = true;
    nodes.push({ label: "P7 EPO request latched", tone: "alarm" });
  } else if (a.epo && changed) {
    nodes.push({ label: "P7 remains latched", tone: "warn" });
  }
  if (changed) return nodes;
  if (!readingChanged(b, a)) return null;
  if (!b.gotTemp) {
    // first valid reading: it establishes the class shown above
    nodes.push({ label: a.pins ? "Outputs unchanged" : "No outputs requested", tone: "info" });
    return nodes;
  }
  // a new reading that keeps the same decision is still worth showing (boundaries, ramps)
  nodes.push({ label: `Still ${CLASS_NAME[a.tempClass]}${a.overload ? " · current warning" : ""}`, tone: classTone(a.tempClass) === "ok" && a.overload ? "warn" : classTone(a.tempClass) });
  nodes.push({ label: a.epo ? "Outputs unchanged · P7 latched" : "Outputs unchanged", tone: a.epo ? "warn" : "info" });
  return nodes;
}

export const readingChanged = (b: ControllerState, a: ControllerState) => b.latestTemp !== a.latestTemp || b.latestCurrent !== a.latestCurrent || b.gotTemp !== a.gotTemp;

/** Causality chain for one P0 evaluation. */
export function resetChain(outcome: ResetOutcome, a: ControllerState): CauseNode[] | null {
  switch (outcome) {
    case "accepted":
      return [
        { label: "New P0 press", tone: "info" },
        { label: `${fmtDegC(a.latestTemp)} Normal · ${fmtAmps(a.latestCurrent)} below 25.6 A`, tone: "ok" },
        { label: "Reset accepted", tone: "ok" },
        { label: "P7 EPO request cleared", tone: "ok" },
      ];
    case "temperature-warm":
    case "temperature-critical":
      return [
        { label: "New P0 press", tone: "info" },
        { label: `Temperature ${CLASS_NAME[a.tempClass]} · ${fmtDegC(a.latestTemp)}`, tone: outcome === "temperature-critical" ? "alarm" : "warn" },
        { label: "Reset refused", tone: "warn" },
        { label: "P7 remains latched", tone: "alarm" },
      ];
    case "current-warning":
      return [
        { label: "New P0 press", tone: "info" },
        { label: `Current ${fmtAmps(a.latestCurrent)} at warning level`, tone: "warn" },
        { label: "Reset refused", tone: "warn" },
        { label: "P7 remains latched", tone: "alarm" },
      ];
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
  const code = reply[0];
  if (r.outcome === "bad-crc") {
    return [{ kind: "validation", title: "CRC rejected · reply 0x5A", detail: `Frame ${hexBytes(frame)}. Reading ignored, reject counter ${a.crcRejects}.`, tone: "warn", focus: "desk", frame, reply }];
  }
  if (r.outcome === "invalid") {
    return [{ kind: "validation", title: "Invalid reading rejected · reply 0x3C", detail: `Frame ${hexBytes(frame)}. Readings, outputs and EPO unchanged.`, tone: "warn", focus: "desk", frame, reply }];
  }
  if (r.outcome !== "accepted") return [];
  const out: Omit<TimelineEntry, "id" | "at" | "values">[] = [];
  const meaningful = recovery || telemetryChain(kind, r, b, a) !== null;
  if (meaningful) {
    out.push({
      kind: "telemetry",
      title: `${recovery ? "Recovery reading" : "Telemetry"} ${readingOf(frame)}`,
      detail: `CRC accepted · reply 0x${hex(code ?? REPLY.OK)} · frame ${hexBytes(frame)}`,
      tone: "info",
      focus: "desk",
      frame,
      reply,
    });
  }
  if (a.tempClass !== b.tempClass) {
    out.push({ kind: "class", title: `Temperature ${CLASS_NAME[b.tempClass]} → ${CLASS_NAME[a.tempClass]}`, detail: fmtDegC(a.latestTemp), tone: classTone(a.tempClass), focus: "rack" });
  }
  for (const p of PIN_TEXT) {
    const on = !!(a.pins & p.bit), was = !!(b.pins & p.bit);
    if (on !== was) out.push({ kind: "output", title: on ? `${p.on} on` : p.off, tone: on ? p.tone : "info", focus: "rack" });
  }
  if (a.epo && !b.epo) {
    const why = [a.tempClass === TEMP_CLASS.CRITICAL && "critical temperature", a.latestCurrent > a.tripCurrent && "current trip"].filter(Boolean).join(" + ");
    out.push({ kind: "epo", title: "P7 EPO request latched", detail: `Cause: ${why}. Trip ${a.epoTrips}.`, tone: "alarm", focus: "rack" });
  }
  return out;
}

export const RESET_ENTRY: Partial<Record<ResetOutcome, { title: string; tone: NoticeTone }>> = {
  accepted: { title: "P0 accepted · EPO request cleared", tone: "ok" },
  "temperature-warm": { title: "P0 blocked · temperature Warm", tone: "warn" },
  "temperature-critical": { title: "P0 blocked · temperature Critical", tone: "alarm" },
  "current-warning": { title: "P0 blocked · current at warning", tone: "warn" },
  held: { title: "P0 blocked · button held", tone: "warn" },
  "not-latched": { title: "P0 pressed · nothing latched", tone: "info" },
};
