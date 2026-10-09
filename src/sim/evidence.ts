/**
 * Evidence mode: for each scenario, what the official case expects and what the controller
 * model was observed to do. Observations come only from the incident timeline, so a check can
 * pass only if the simulated controller really produced that reply, output or reset decision.
 */
import { REPLY, PIN, hex, hexBytes } from "./protocol";
import type { ControllerState } from "./controller";
import type { TimelineEntry } from "./timeline";
import { fmtAmps, fmtDegC } from "./units";

export type CheckStatus = "pass" | "fail" | "pending";

export interface CheckResult {
  label: string;
  expected: string;
  observed: string;
  status: CheckStatus;
}

interface Ctx {
  timeline: TimelineEntry[];
  state: ControllerState;
  /** The scenario has finished; "never" checks may now pass. */
  done: boolean;
}

type Check = (c: Ctx) => CheckResult;

const P = { P4: PIN.FAN_BOOST, P5: PIN.FAN_MAX, P6: PIN.CURRENT_WARNING, P7: PIN.EPO_REQUEST };
const pinNames = (m: number) => (Object.entries(P).filter(([, b]) => m & b).map(([n]) => n).join(" + ") || "none");
const at = (e: TimelineEntry) => `t+${(e.at / 1000).toFixed(1)} s`;
const readingOf = (e: TimelineEntry) => (e.values.temp === null ? "no reading" : `${fmtDegC(e.values.temp)} · ${fmtAmps(e.values.current ?? 0)}`);

/** A reply code was sent back for some packet. */
function reply(code: number, label: string): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => x.reply?.[0] === code);
    return {
      label,
      expected: `Reply 0x${hex(code)}`,
      observed: e ? `0x${hex(code)} at ${at(e)} · ${hexBytes(e.frame ?? [])}` : "not yet",
      status: e ? "pass" : "pending",
    };
  };
}

/** Some event left the outputs with all of `mask` on (and none of `without`). */
function pins(mask: number, label: string, without = 0, where?: (e: TimelineEntry) => boolean): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => (x.values.pins & mask) === mask && !(x.values.pins & without) && (!where || where(x)));
    return {
      label,
      expected: `${pinNames(mask)} on${without ? `, ${pinNames(without)} off` : ""}`,
      observed: e ? `${pinNames(e.values.pins)} at ${at(e)} (${readingOf(e)})` : "not yet",
      status: e ? "pass" : "pending",
    };
  };
}

/** An output must never come on during the scenario. */
function never(mask: number, label: string): Check {
  return ({ timeline, done }) => {
    const e = timeline.find((x) => x.values.pins & mask);
    return {
      label,
      expected: `${pinNames(mask)} never on`,
      observed: e ? `${pinNames(e.values.pins & mask)} at ${at(e)}` : done ? "never on" : "so far off",
      status: e ? "fail" : done ? "pass" : "pending",
    };
  };
}

/** A P0 evaluation with this outcome happened. */
function reset(outcome: string, label: string, expected: string): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => x.reset === outcome);
    return { label, expected, observed: e ? `${e.title} at ${at(e)}` : "not yet", status: e ? "pass" : "pending" };
  };
}

/** At the end, the latch is in this state. */
function finalEpo(latched: boolean, label: string): Check {
  return ({ state, done }) => ({
    label,
    expected: latched ? "P7 latched" : "P7 clear",
    observed: state.epo ? "P7 latched" : "P7 clear",
    status: !done ? "pending" : state.epo === latched ? "pass" : "fail",
  });
}

const latchedWhile = (where: (e: TimelineEntry) => boolean, label: string, expected: string): Check =>
  ({ timeline }) => {
    const e = timeline.find((x) => x.values.epo && where(x));
    return { label, expected, observed: e ? `P7 latched at ${at(e)} (${readingOf(e)})` : "not yet", status: e ? "pass" : "pending" };
  };

const safe = (e: TimelineEntry) => e.values.temp !== null && e.values.temp < 54 && (e.values.current ?? 255) < 128;

const CHECKS: Record<string, Check[]> = {
  normal: [reply(REPLY.OK, "Sample accepted"), never(0xf0, "No output requested")],
  warm: [
    pins(P.P4, "27.0 °C is Warm", P.P7),
    pins(P.P4, "Exactly 32.0 °C is still Warm", P.P5 | P.P7, (e) => e.values.temp === 64),
    never(P.P7, "No EPO request"),
  ],
  "critical-heat": [pins(P.P5 | P.P7, "32.5 °C is Critical"), reset("accepted", "Reset after cooling", "P0 accepted once Normal"), finalEpo(false, "Latch cleared")],
  "current-warning": [pins(P.P6, "25.6 A warns", P.P7), pins(P.P6, "Exactly 32.0 A still a warning", P.P7, (e) => e.values.current === 160), never(P.P7, "No EPO request")],
  "current-trip": [pins(P.P6 | P.P7, "32.2 A trips"), reset("accepted", "Reset below 25.6 A", "P0 accepted"), finalEpo(false, "Latch cleared")],
  combined: [
    pins(P.P5 | P.P6 | P.P7, "Heat and current together"),
    latchedWhile((e) => e.values.temp !== null && e.values.temp < 54 && (e.values.current ?? 0) > 160, "Current alone keeps P7", "P7 latched at Normal temperature"),
    reset("accepted", "Reset after both recover", "P0 accepted"),
  ],
  recover: [pins(P.P5 | P.P7, "Heat trip"), latchedWhile(safe, "Safe readings do not clear P7", "P7 latched at safe readings"), reset("accepted", "Operator acknowledges", "P0 accepted")],
  "reset-warm": [reset("temperature-warm", "Press while Warm", "P0 refused (Warm)"), reset("accepted", "Press once Normal", "P0 accepted")],
  "reset-current": [reset("current-warning", "Press at 25.6 A", "P0 refused (current warning)"), reset("accepted", "Press below 25.6 A", "P0 accepted")],
  "held-button": [
    latchedWhile((e) => safe(e) && e.values.p0, "Held P0 cannot reset", "P7 latched with P0 held"),
    reset("accepted", "Release, then a new press", "P0 accepted"),
  ],
  invalid: [reply(REPLY.INVALID, "Temperature raw 0 rejected"), latchedWhile((e) => e.reply?.[0] === REPLY.INVALID, "State unchanged", "P7 still latched after 0x3C"), reset("accepted", "Valid recovery, then P0", "P0 accepted")],
  corrupt: [reply(REPLY.BAD_CRC, "Bad CRC rejected"), latchedWhile((e) => e.reply?.[0] === REPLY.BAD_CRC, "Safe-looking packet ignored", "P7 still latched after 0x5A"), reset("accepted", "Valid recovery, then P0", "P0 accepted")],
  "no-telemetry": [
    ({ timeline }) => {
      const e = timeline.find((x) => x.kind === "link" && x.title.includes("silent"));
      return { label: "Link goes silent", expected: "No new telemetry", observed: e ? `silent from ${at(e)}` : "not yet", status: e ? "pass" : "pending" };
    },
    reset("accepted", "P0 works without telemetry", "P0 accepted locally"),
  ],
};

export function evaluateEvidence(scenarioId: string, timeline: TimelineEntry[], state: ControllerState, done: boolean): CheckResult[] {
  return (CHECKS[scenarioId] ?? []).map((c) => c({ timeline, state, done }));
}

export const hasEvidence = (scenarioId: string) => scenarioId in CHECKS;
