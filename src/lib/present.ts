/**
 * Human-readable presentation of controller state. Every state pairs a semantic tone with an
 * icon so meaning never depends on colour alone.
 */
import { TEMP_CLASS, type ControllerState, type ResetOutcome } from "@/sim/controller";
import { RESET_MESSAGES } from "@/sim/runtime";
import type { IconName } from "@/components/icons";
import { fmtAmps, fmtDegC } from "@/sim/units";

export type Tone = "normal" | "warning" | "critical" | "neutral" | "off";

export interface StateInfo {
  label: string;
  tone: Tone;
  icon: IconName;
  /** Optional supporting line. */
  sub?: string;
}

export function tempInfo(s: ControllerState): StateInfo {
  if (!s.gotTemp) return { label: "No data", tone: "off", icon: "info" };
  if (s.tempClass === TEMP_CLASS.CRITICAL) return { label: "Critical", tone: "critical", icon: "crit" };
  if (s.tempClass === TEMP_CLASS.WARM) return { label: "Warm", tone: "warning", icon: "warn" };
  return { label: "Normal", tone: "normal", icon: "ok" };
}

export function currentInfo(s: ControllerState): StateInfo {
  if (!s.gotCurrent) return { label: "No data", tone: "off", icon: "info" };
  if (s.latestCurrent > s.tripCurrent) return { label: "Trip", tone: "critical", icon: "crit" };
  if (s.overload) return { label: "Warning", tone: "warning", icon: "warn" };
  return { label: "Normal", tone: "normal", icon: "ok" };
}

/** Primary 1: what is the rack condition? */
export function conditionInfo(s: ControllerState): StateInfo {
  if (!s.gotTemp) return { label: "Waiting for data", tone: "off", icon: "info", sub: "No telemetry yet" };
  const sub = `${fmtDegC(s.latestTemp)} · ${fmtAmps(s.latestCurrent)}`;
  const t = tempInfo(s), c = currentInfo(s);
  if (t.tone === "critical" && c.tone === "critical") return { label: "Critical", tone: "critical", icon: "crit", sub: "Heat and current" };
  if (t.tone === "critical") return { label: "Critical heat", tone: "critical", icon: "crit", sub };
  if (c.tone === "critical") return { label: "Current trip", tone: "critical", icon: "crit", sub };
  if (t.tone === "warning" && c.tone === "warning") return { label: "Warm + current", tone: "warning", icon: "warn", sub };
  if (t.tone === "warning") return { label: "Warm", tone: "warning", icon: "warn", sub };
  if (c.tone === "warning") return { label: "Current warning", tone: "warning", icon: "warn", sub };
  return { label: "Normal", tone: "normal", icon: "ok", sub };
}

/** Primary 2: is the EPO request latched? */
export function epoInfo(s: ControllerState): StateInfo {
  return s.epo
    ? { label: "Request latched", tone: "critical", icon: "crit", sub: `P7 on · trips ${s.epoTrips}` }
    : { label: "Armed", tone: "normal", icon: "ok", sub: `P7 off · trips ${s.epoTrips}` };
}

/** Primary 3: what can the operator do? */
export function resetInfo(s: ControllerState, blockers: ResetOutcome[]): StateInfo {
  if (!s.epo) return { label: "Not required", tone: "off", icon: "info", sub: "Nothing latched" };
  const b = blockers.filter((x) => x !== "not-latched");
  if (!b.length) return { label: "Available", tone: "neutral", icon: "ok", sub: "Press P0 to acknowledge" };
  return { label: "Blocked", tone: "warning", icon: "lock", sub: BLOCKER_SHORT[b[0]] };
}

export function fanInfo(s: ControllerState): StateInfo {
  if (s.tempClass === TEMP_CLASS.CRITICAL) return { label: "Maximum (P5)", tone: "critical", icon: "crit" };
  if (s.tempClass === TEMP_CLASS.WARM) return { label: "Boost (P4)", tone: "warning", icon: "warn" };
  return { label: "Normal speed", tone: "normal", icon: "ok" };
}

export const BLOCKER_TEXT: Record<ResetOutcome, string> = {
  "temperature-critical": "Temperature is Critical (must be below 27.0 °C)",
  "temperature-warm": "Temperature remains Warm (must be below 27.0 °C)",
  "current-warning": "Current remains at warning level (must be below 25.6 A)",
  held: "P0 is held down: release P0 and press again",
  "not-latched": "Nothing to reset: no EPO request is latched",
  accepted: "",
  released: "",
};

export const BLOCKER_SHORT: Record<ResetOutcome, string> = {
  "temperature-critical": "Temperature Critical",
  "temperature-warm": "Temperature Warm",
  "current-warning": "Current at warning",
  held: "Release P0, press again",
  "not-latched": "Nothing latched",
  accepted: "",
  released: "",
};

export const resetMessage = (o: ResetOutcome) => RESET_MESSAGES[o];

export const PIN_LABELS = [
  { bit: 0x10, pin: "P4", name: "Fan Boost" },
  { bit: 0x20, pin: "P5", name: "Maximum Fan" },
  { bit: 0x40, pin: "P6", name: "Current Warning" },
  { bit: 0x80, pin: "P7", name: "EPO Request" },
] as const;

export function pinTone(bit: number): Tone {
  return bit === 0x20 || bit === 0x80 ? "critical" : "warning";
}

export function pinIcon(bit: number): IconName {
  return bit === 0x10 || bit === 0x20 ? "temp" : bit === 0x40 ? "bolt" : "crit";
}

/** Simulation time as m:ss for alert timestamps. */
export function fmtSimTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `t+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
