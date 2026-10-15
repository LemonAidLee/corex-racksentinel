/**
 * Human-readable presentation of controller state. Every state pairs a semantic tone with an
 * icon so meaning never depends on colour alone.
 */
import { CFG, SETTINGS_MASK, TEMP_CLASS, settingsView, type ControllerState, type ResetOutcome } from "@/sim/controller";
import { RESET_MESSAGES } from "@/sim/runtime";
import { INPUT, causeText } from "@/sim/protocol";
import type { IconName } from "@/components/icons";
import { fmtAmps, fmtDegC, fmtKW } from "@/sim/units";

export type Tone = "normal" | "warning" | "critical" | "neutral" | "off";

export interface StateInfo {
  label: string;
  tone: Tone;
  icon: IconName;
  /** Optional supporting line. */
  sub?: string;
}

const wet = (s: ControllerState) => !!(s.inputs & INPUT.LEAK);
const faulty = (s: ControllerState) => !!(s.fault & SETTINGS_MASK);

export function tempInfo(s: ControllerState): StateInfo {
  if (!s.gotTemp) return { label: "No data", tone: "off", icon: "info" };
  if (s.tempClass === TEMP_CLASS.CRITICAL) return { label: "Critical", tone: "critical", icon: "crit" };
  if (s.tempClass === TEMP_CLASS.HOT) return { label: "Hot", tone: "warning", icon: "warn" };
  if (s.tempClass === TEMP_CLASS.WARM) return { label: "Warm", tone: "warning", icon: "warn" };
  return { label: "Normal", tone: "normal", icon: "ok" };
}

export function powerInfo(s: ControllerState): StateInfo {
  if (s.power === null) return { label: "No data", tone: "off", icon: "info" };
  if (s.overload) return { label: "Overload", tone: "warning", icon: "warn", sub: fmtKW(s.power) };
  return { label: "Normal", tone: "normal", icon: "ok", sub: fmtKW(s.power) };
}

export function leakInfo(s: ControllerState): StateInfo {
  return wet(s) ? { label: "Wet", tone: "critical", icon: "drop" } : { label: "Dry", tone: "normal", icon: "ok" };
}

/** Primary 1: what is the rack condition? */
export function conditionInfo(s: ControllerState): StateInfo {
  if (wet(s)) return { label: "Water leak", tone: "critical", icon: "drop", sub: "Leak sensor P1 wet" };
  if (faulty(s)) return { label: "Setting unreadable", tone: "critical", icon: "chip", sub: "Two flipped bits" };
  if (!s.gotTemp) return { label: "Waiting for data", tone: "off", icon: "info", sub: "No readings yet" };
  const sub = `${fmtDegC(s.latestTemp)} · ${s.power === null ? "no current" : fmtKW(s.power)}`;
  if (s.tempClass === TEMP_CLASS.CRITICAL) return { label: "Critical heat", tone: "critical", icon: "crit", sub };
  if (s.rapid) return { label: "Thermal runaway", tone: "critical", icon: "crit", sub };
  const t = tempInfo(s);
  if (t.tone === "warning" && s.overload) return { label: `${t.label} + overload`, tone: "warning", icon: "warn", sub };
  if (t.tone === "warning") return { label: t.label, tone: "warning", icon: "warn", sub };
  if (s.overload) return { label: "Power overload", tone: "warning", icon: "warn", sub };
  return { label: "Normal", tone: "normal", icon: "ok", sub };
}

/** Primary 2: is the power-off latched? */
export function epoInfo(s: ControllerState): StateInfo {
  if (!s.epo) return { label: "Armed", tone: "normal", icon: "ok", sub: `P7 off · trips ${s.epoTrips}` };
  const cause = settingsView(s)[CFG.TRIP_CAUSE].value;
  return { label: "Power-off latched", tone: "critical", icon: "crit", sub: `${causeText(cause)} · trip ${s.epoTrips}` };
}

/** Primary 3: what can the operator do? */
export function resetInfo(s: ControllerState, blockers: ResetOutcome[]): StateInfo {
  if (!s.epo) return { label: "Not required", tone: "off", icon: "info", sub: "Nothing latched" };
  const b = blockers.filter((x) => x !== "not-latched");
  if (!b.length) return { label: "Available", tone: "neutral", icon: "ok", sub: "Press P0 to acknowledge" };
  return { label: "Blocked", tone: "warning", icon: "lock", sub: BLOCKER_SHORT[b[0]] };
}

export function fanInfo(s: ControllerState): StateInfo {
  if (s.tempClass >= TEMP_CLASS.HOT) return { label: "Maximum (P5)", tone: s.tempClass === TEMP_CLASS.CRITICAL ? "critical" : "warning", icon: "fan" };
  if (s.tempClass === TEMP_CLASS.WARM) return { label: "Boost (P4)", tone: "warning", icon: "fan" };
  return { label: "Normal speed", tone: "normal", icon: "ok" };
}

export const BLOCKER_TEXT: Record<ResetOutcome, string> = {
  "temperature-critical": "Temperature is Critical (must be below the Critical threshold)",
  leak: "The leak sensor on P1 is still wet",
  runaway: "The latest reading was a thermal runaway (a new reading without the steep rise is needed)",
  "config-fault": "A safety setting is unreadable (the DCIM must rewrite it)",
  held: "P0 is held down: release P0 and press again",
  "not-latched": "Nothing to reset: no power-off is latched",
  accepted: "",
  released: "",
};

export const BLOCKER_SHORT: Record<ResetOutcome, string> = {
  "temperature-critical": "Temperature Critical",
  leak: "Leak sensor wet",
  runaway: "Runaway on last reading",
  "config-fault": "Setting unreadable",
  held: "Release P0, press again",
  "not-latched": "Nothing latched",
  accepted: "",
  released: "",
};

export const resetMessage = (o: ResetOutcome) => RESET_MESSAGES[o];

export const PIN_LABELS = [
  { bit: 0x10, pin: "P4", name: "Fan Boost" },
  { bit: 0x20, pin: "P5", name: "Fans Maximum" },
  { bit: 0x40, pin: "P6", name: "Overload Alarm" },
  { bit: 0x80, pin: "P7", name: "Power-Off" },
] as const;

export function pinTone(bit: number): Tone {
  return bit === 0x80 ? "critical" : "warning";
}

export function pinIcon(bit: number): IconName {
  return bit === 0x10 || bit === 0x20 ? "fan" : bit === 0x40 ? "bolt" : "crit";
}

export { fmtAmps, fmtDegC, fmtKW };

/** Simulation time as m:ss for alert timestamps. */
export function fmtSimTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `t+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
