/**
 * Evidence mode: for each scenario, what the rehearsed FPGA run (or the rule) expects and what
 * the controller model was observed to do. Observations come only from the incident timeline,
 * so a check can pass only if the simulated controller really produced that reply, output or
 * reset decision.
 */
import { REPLY, PIN, CMD, CMD_NAME, hex, hexBytes } from "./protocol";
import type { ControllerState, ResetOutcome } from "./controller";
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

const P = { P4: PIN.FAN_BOOST, P5: PIN.FAN_MAX, P6: PIN.OVERLOAD, P7: PIN.EPO };
const pinNames = (m: number) => Object.entries(P).filter(([, b]) => m & b).map(([n]) => n).join(" + ") || "none";
const at = (e: TimelineEntry) => `t+${(e.at / 1000).toFixed(1)} s`;
const readingOf = (e: TimelineEntry) => (e.values.temp === null ? "no reading" : `${fmtDegC(e.values.temp)} · ${fmtAmps(e.values.current ?? 0)}`);

/** A reply code was sent back for some packet. */
function reply(code: number, label: string): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => x.reply?.length === 1 && x.reply[0] === code);
    return { label, expected: `Reply 0x${hex(code)}`, observed: e ? `0x${hex(code)} at ${at(e)} · ${hexBytes(e.frame ?? [])}` : "not yet", status: e ? "pass" : "pending" };
  };
}

/** A query was answered with exactly these bytes (in the order sent). */
function query(cmd: number, bytes: number[], label: string): Check {
  return ({ timeline }) => {
    const answers = timeline.filter((x) => x.kind === "query" && x.frame?.[0] === cmd);
    const hit = answers.find((x) => hexBytes(x.reply ?? []) === hexBytes(bytes));
    const last = answers.at(-1);
    return {
      label,
      expected: `${CMD_NAME[cmd]} → ${hexBytes(bytes)}`,
      observed: hit ? `${hexBytes(bytes)} at ${at(hit)}` : last ? hexBytes(last.reply ?? []) : "not yet",
      status: hit ? "pass" : last ? "fail" : "pending",
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

/** After some event, `mask` is off while the condition holds. */
function pinsOff(mask: number, label: string, where: (e: TimelineEntry) => boolean): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => !(x.values.pins & mask) && where(x));
    return { label, expected: `${pinNames(mask)} off`, observed: e ? `${pinNames(e.values.pins)} at ${at(e)} (${readingOf(e)})` : "not yet", status: e ? "pass" : "pending" };
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
function reset(outcome: ResetOutcome, label: string, expected: string): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => x.reset === outcome);
    return { label, expected, observed: e ? `${e.title} at ${at(e)}` : "not yet", status: e ? "pass" : "pending" };
  };
}

/** The power-off latched with this cause. */
function tripCause(text: string, label: string, where?: (e: TimelineEntry) => boolean): Check {
  return ({ timeline }) => {
    const e = timeline.find((x) => x.kind === "epo" && (!where || where(x)));
    const ok = !!e && (e.detail ?? "").includes(text);
    return { label, expected: `Power-off latched: ${text}`, observed: e ? `${e.detail} (${at(e)})` : "not yet", status: ok ? "pass" : e ? "fail" : "pending" };
  };
}

const latchedWhile = (where: (e: TimelineEntry) => boolean, label: string, expected: string): Check =>
  ({ timeline }) => {
    const e = timeline.find((x) => x.values.epo && where(x));
    return { label, expected, observed: e ? `P7 latched at ${at(e)} (${readingOf(e)})` : "not yet", status: e ? "pass" : "pending" };
  };

const silent = (label: string): Check => ({ timeline }) => {
  const e = timeline.find((x) => x.kind === "link" && x.title.includes("silent"));
  return { label, expected: "No telemetry", observed: e ? `silent from ${at(e)}` : "not yet", status: e ? "pass" : "pending" };
};

const accepted = reset("accepted", "Operator acknowledges", "P0 accepted");

const CHECKS: Record<string, Check[]> = {
  normal: [reply(REPLY.OK, "Readings accepted"), query(CMD.STATUS, [0x40, 0x2c, 0x64, 0x00], "STATUS as in R1"), never(0xf0, "No output requested")],
  "heat-up": [
    pins(P.P4, "27.0 °C is Warm", P.P5 | P.P7, (e) => e.values.temp === 54),
    pins(P.P5, "32.0 °C is Hot", P.P4 | P.P7, (e) => e.values.temp === 64),
    never(P.P7, "No power-off below Critical"),
  ],
  critical: [
    pins(P.P5 | P.P7, "35.0 °C is Critical", 0, (e) => e.values.temp === 70),
    reset("temperature-critical", "Reset while Critical", "P0 refused"),
    reset("accepted", "Reset once below Critical", "P0 accepted while Warm"),
    query(CMD.TRIP_INFO, [0x01, 0x46, 0x64, 0x01], "Trip record"),
  ],
  runaway: [
    tripCause("thermal runaway", "Runaway trips while Normal", (e) => (e.values.temp ?? 99) < 54),
    accepted,
    query(CMD.TRIP_INFO, [0x02, 0x35, 0x64, 0x01], "Trip record"),
  ],
  leak: [
    tripCause("water leak", "Leak trips with no packet"),
    reset("leak", "Reset while wet", "P0 refused"),
    accepted,
    query(CMD.TRIP_INFO, [0x04, 0x2c, 0x64, 0x01], "Trip record"),
  ],
  overload: [
    pins(P.P6, "26.0 A × 230 V overloads", P.P7, (e) => e.values.current === 130),
    pinsOff(P.P6, "25.0 A at 230 V does not", (e) => e.values.current === 125 && e.kind === "output"),
    never(P.P7, "Overload never cuts power"),
  ],
  energy: [query(CMD.ENERGY, [0xe6, 0x00, 0x00, 0x00], "230 Wh as in R7")],
  "ecc-one": [
    query(CMD.COUNTERS, [0x00, 0x01, 0x00, 0x00], "One correction counted"),
    pins(P.P5, "34.5 °C is Hot", P.P7, (e) => e.values.temp === 69),
    pins(P.P7, "Critical still at 35.0 °C", 0, (e) => e.values.temp === 70),
    accepted,
  ],
  "ecc-two": [
    tripCause("unreadable setting", "Fail-safe on a normal reading", (e) => e.values.temp === 44),
    reset("config-fault", "Reset with the setting unreadable", "P0 refused"),
    accepted,
    query(CMD.TRIP_INFO, [0x08, 0x2c, 0x00, 0x01], "Trip record as in R9"),
  ],
  "held-button": [
    latchedWhile((e) => e.values.p0 && e.values.tempClass < 3 && !e.values.rapid && !e.values.leak, "Held P0 cannot reset", "P7 latched with P0 held"),
    reset("accepted", "Release, then a new press", "P0 accepted"),
  ],
  corrupt: [
    reply(REPLY.BAD_CRC, "Damaged packet rejected"),
    latchedWhile((e) => e.reply?.[0] === REPLY.BAD_CRC, "Safe-looking packet ignored", "P7 still latched after 0x5A"),
    accepted,
  ],
  invalid: [
    reply(REPLY.INVALID, "Raw 0 and a bad setting rejected"),
    ({ timeline }) => {
      const n = timeline.filter((x) => x.reply?.[0] === REPLY.INVALID).length;
      return { label: "Both rejections", expected: "2 × 0x3C", observed: `${n} × 0x3C`, status: n >= 2 ? "pass" : "pending" };
    },
    never(P.P7, "Nothing latched"),
  ],
  "silent-leak": [silent("Link goes silent"), tripCause("water leak", "Leak caught without the link"), accepted],
};

export function evaluateEvidence(scenarioId: string, timeline: TimelineEntry[], state: ControllerState, done: boolean): CheckResult[] {
  return (CHECKS[scenarioId] ?? []).map((c) => c({ timeline, state, done }));
}

export const hasEvidence = (scenarioId: string) => scenarioId in CHECKS;
