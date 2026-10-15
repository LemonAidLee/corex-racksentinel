/**
 * Scenario definitions: Ali's day as a data-centre operator, one scenario per rehearsed FPGA run
 * (R1 to R9, stage4_fpga/evidence) plus four extras for the reset button and the link.
 * Every scenario is a deterministic, timed list of steps that starts from a controller power-on.
 * Values are real units, converted to raw steps exactly (0.2 A, 0.5 °C).
 *
 * Recovery is always external: RackSentinel only measures the rack and requests outputs.
 * Temperature changes only when the simulated environment sends a new reading (`recover`).
 * A latched power-off is cleared only by the operator's new P0 press (`acknowledge`).
 *
 * Temperature climbs one 0.5 °C step at a time, as a real room does. A jump of 2.0 °C or more
 * between two readings is a thermal runaway; the cooling-failure scenario does that on purpose.
 */
import type { NoticeTone } from "./events";
import { CMD } from "./protocol";
import { ampsToRaw, degCToRaw, rawToAmps, rawToDegC } from "./units";

export type ScenarioStep =
  /** External rack conditions change; the DCIM sends TEMP and CURRENT immediately. */
  | { at: number; type: "conditions"; amps: number; degC: number }
  /** Simulated external recovery: the rack environment improves and the DCIM sends it. */
  | { at: number; type: "recover"; amps: number; degC: number }
  /** A TEMP packet whose DATA byte is damaged on the wire (the CRC no longer matches). */
  | { at: number; type: "corrupt"; degC: number }
  /** A TEMP packet with raw value 0, which the controller must reject. */
  | { at: number; type: "invalid" }
  /** A DCIM command: a setting, a query or the ECC self-test. */
  | { at: number; type: "command"; cmd: number; data: number }
  /** The leak sensor on P1 gets wet or dries. */
  | { at: number; type: "leak"; wet: boolean }
  /** The operator walks to P0 and presses it once, whatever the conditions (demonstrates a refusal). */
  | { at: number; type: "press" }
  /** P0 is held down (e.g. taped or stuck). */
  | { at: number; type: "hold" }
  /** A held P0 is let go. */
  | { at: number; type: "release" }
  /** Telemetry stream on or off. */
  | { at: number; type: "stream"; on: boolean }
  /** A short alert. */
  | { at: number; type: "note"; title: string; detail?: string; tone?: NoticeTone }
  /** What the scenario is showing right now (shown in the prompt bar while it plays). */
  | { at: number; type: "stage"; title: string; detail?: string; tone?: NoticeTone }
  /**
   * Recovery phase: once the controller would accept a reset with the power-off still latched,
   * wait `dwell` ms so the latch is visible, then send the operator to make a new P0 press.
   */
  | { at: number; type: "acknowledge"; dwell?: number };

export interface Scenario {
  id: string;
  name: string;
  /** Ali's moment, one line. */
  moment: string;
  summary: string;
  /** "R1" … "R9" for the rehearsed FPGA runs, or "Extra". */
  testCase: string;
  steps: ScenarioStep[];
}

type Reading = { amps: number; degC: number };

const N: Reading = { amps: 20.0, degC: 22.0 }; // R1: a healthy rack

/** Protocol steps between two readings; one step is 0.2 A or 0.5 °C. */
const stepsBetween = (from: Reading, to: Reading) =>
  Math.max(Math.abs(ampsToRaw(to.amps) - ampsToRaw(from.amps)), Math.abs(degCToRaw(to.degC) - degCToRaw(from.degC)));

/**
 * A gradual change: the rack walks from `from` to `to` one protocol step at a time, each step
 * sent as its own reading. `type` is "conditions" for a worsening rack, "recover" for recovery.
 */
export function ramp(type: "conditions" | "recover", startAt: number, from: Reading, to: Reading, totalMs = 6000): ScenarioStep[] {
  const n = stepsBetween(from, to);
  if (n === 0) return [];
  let a = ampsToRaw(from.amps);
  let t = degCToRaw(from.degC);
  const aTo = ampsToRaw(to.amps);
  const tTo = degCToRaw(to.degC);
  const out: ScenarioStep[] = [];
  for (let i = 1; i <= n; i++) {
    a += Math.sign(aTo - a);
    t += Math.sign(tTo - t);
    out.push({ at: Math.round(startAt + (i * totalMs) / n), type, amps: rawToAmps(a), degC: rawToDegC(t) });
  }
  return out;
}

const query = (at: number, cmd: number): ScenarioStep => ({ at, type: "command", cmd, data: 0 });

export const SCENARIOS: Scenario[] = [
  // ------------------------------------------------------------------ heat and cooling
  {
    id: "normal",
    name: "Morning check",
    moment: "Ali starts the shift: is the rack healthy?",
    summary: "22.0 °C and 20 A. No outputs. STATUS reports both readings and no trips.",
    testCase: "R1",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 900, type: "stage", title: "Normal readings", detail: "22.0 °C, 20.0 A, 4.6 kW. No outputs requested.", tone: "ok" },
      query(2500, CMD.STATUS),
      { at: 2600, type: "stage", title: "STATUS: Normal, 22.0 °C, 20.0 A, 0 trips", detail: "Reply 40 2C 64 00: flags, temperature, current, trips.", tone: "ok" },
    ],
  },
  {
    id: "heat-up",
    name: "Afternoon heat",
    moment: "The hall warms up through the afternoon.",
    summary: "The rack climbs 0.5 °C at a time: fan boost from 27.0 °C, fans at maximum from 32.0 °C. No power-off.",
    testCase: "R2",
    steps: [
      { at: 300, type: "conditions", amps: 20, degC: 26.5 },
      ...ramp("conditions", 1500, { amps: 20, degC: 26.5 }, { amps: 20, degC: 32.0 }, 8000),
      { at: 2300, type: "stage", title: "Warm from 27.0 °C · P4 fan boost", detail: "Above the ASHRAE recommended range.", tone: "warn" },
      { at: 9700, type: "stage", title: "Hot from 32.0 °C · P5 fans at maximum", detail: "Above the class A1 allowable limit. Still no power-off.", tone: "warn" },
      ...ramp("recover", 12500, { amps: 20, degC: 32.0 }, { amps: 20, degC: 26.5 }, 6000),
    ],
  },
  {
    id: "critical",
    name: "Overheat",
    moment: "A hot afternoon becomes dangerous.",
    summary: "35.0 °C is Critical: power-off latched. A reset is refused while Critical, accepted once it cools below 35.0 °C.",
    testCase: "R3",
    steps: [
      { at: 300, type: "conditions", amps: 20, degC: 31.0 },
      ...ramp("conditions", 1200, { amps: 20, degC: 31.0 }, { amps: 20, degC: 35.0 }, 5000),
      { at: 8200, type: "press" },
      ...ramp("recover", 11500, { amps: 20, degC: 35.0 }, { amps: 20, degC: 30.0 }, 5000),
      { at: 16600, type: "acknowledge" },
      query(24000, CMD.TRIP_INFO),
      { at: 24100, type: "stage", title: "TRIP_INFO: Critical temperature at 35.0 °C", detail: "The trip record survives the reset until the next trip.", tone: "info" },
    ],
  },
  {
    id: "runaway",
    name: "Cooling failure",
    moment: "A cooling unit fails while the rack still looks Normal.",
    summary: "24.0 °C jumps to 26.5 °C in one reading. That rise means the cooling failed: power-off before any threshold.",
    testCase: "R4",
    steps: [
      { at: 300, type: "conditions", amps: 20, degC: 24.0 },
      { at: 900, type: "stage", title: "24.0 °C, Normal", detail: "Runaway limit: 2.0 °C between two readings.", tone: "ok" },
      { at: 3500, type: "conditions", amps: 20, degC: 26.5 },
      { at: 3600, type: "stage", title: "+2.5 °C in one reading · thermal runaway", detail: "Still below 27.0 °C, but the cooling has failed. Power-off latched.", tone: "alarm" },
      { at: 7000, type: "recover", amps: 20, degC: 27.0 },
      { at: 7100, type: "acknowledge" },
      query(16000, CMD.TRIP_INFO),
    ],
  },
  // ------------------------------------------------------------------ water and power
  {
    id: "leak",
    name: "Water leak",
    moment: "A chilled-water pipe leaks under the floor.",
    summary: "The leak sensor on P1 cuts power with no message on the link. Reset only once the sensor is dry.",
    testCase: "R5",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2500, type: "leak", wet: true },
      { at: 2600, type: "stage", title: "Water on P1 · power-off latched", detail: "The chip watches P1 itself: no UART message needed.", tone: "alarm" },
      { at: 5500, type: "press" },
      { at: 9000, type: "leak", wet: false },
      { at: 9100, type: "stage", title: "Sensor dry · power-off still latched", detail: "Dry is not enough: a person must acknowledge.", tone: "warn" },
      { at: 9200, type: "acknowledge" },
      query(17000, CMD.TRIP_INFO),
    ],
  },
  {
    id: "overload",
    name: "New server, more load",
    moment: "A new server pushes the rack past its power budget.",
    summary: "Power = V × I. 26 A at 230 V is 5.98 kW, over the 5.9 kW limit: P6 alarm, no outage. 240 V makes 25 A an overload too.",
    testCase: "R6",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2500, type: "conditions", amps: 26.0, degC: 22.0 },
      { at: 2600, type: "stage", title: "26.0 A × 230 V = 5.98 kW · P6 overload alarm", detail: "At or above the 5.9 kW limit. A warning, not a power-off.", tone: "warn" },
      { at: 5500, type: "conditions", amps: 25.0, degC: 22.0 },
      { at: 5600, type: "stage", title: "25.0 A = 5.75 kW · alarm off", detail: "The alarm follows the latest reading; it does not latch.", tone: "ok" },
      { at: 8500, type: "command", cmd: CMD.SET_VOLTAGE, data: 240 },
      { at: 8600, type: "stage", title: "SET_VOLTAGE 240 V", detail: "The same 25.0 A now means 6.00 kW.", tone: "info" },
      { at: 10500, type: "conditions", amps: 25.0, degC: 22.0 },
      { at: 10600, type: "stage", title: "25.0 A × 240 V = 6.00 kW · P6 overload alarm", tone: "warn" },
      { at: 13500, type: "conditions", ...N },
      { at: 13600, type: "stage", title: "Load shed to 20.0 A · alarm off", tone: "ok" },
      { at: 15500, type: "command", cmd: CMD.SET_VOLTAGE, data: 230 },
    ],
  },
  {
    id: "energy",
    name: "Energy report",
    moment: "Ali reads the energy meter for the monthly report.",
    summary: "Three readings of 20 A at 230 V count as three minutes at 4.6 kW: 230 Wh, divided by 300 without a divider.",
    testCase: "R7",
    steps: [
      { at: 100, type: "stream", on: false },
      { at: 600, type: "conditions", ...N },
      { at: 2400, type: "conditions", ...N },
      { at: 4200, type: "conditions", ...N },
      { at: 4300, type: "stage", title: "Three readings at 4.6 kW", detail: "Each CURRENT reading counts as one minute.", tone: "info" },
      query(6500, CMD.ENERGY),
      { at: 6600, type: "stage", title: "ENERGY: 230 Wh", detail: "69,000 × 0.2 W·min ÷ 300 = 230 Wh, done as mulhu and a shift.", tone: "ok" },
      { at: 9000, type: "stream", on: true },
    ],
  },
  // ------------------------------------------------------------------ memory faults (ECC)
  {
    id: "ecc-one",
    name: "One bit flips",
    moment: "A radiation hit flips one bit of the Critical threshold.",
    summary: "FLIP_TEST flips one bit of Critical. The chip repairs it at the next reading: Hot at 34.5 °C, Critical at exactly 35.0 °C.",
    testCase: "R8",
    steps: [
      { at: 100, type: "stream", on: false },
      { at: 600, type: "command", cmd: CMD.FLIP_TEST, data: 0x02 },
      { at: 700, type: "stage", title: "One bit of the Critical threshold flipped", detail: "Self-test FLIP_TEST 0x02.", tone: "warn" },
      { at: 2500, type: "conditions", amps: 20, degC: 34.5 },
      { at: 2600, type: "stage", title: "Repaired at the next use · 34.5 °C is Hot", detail: "ECC corrected the bit and wrote it back.", tone: "ok" },
      { at: 5500, type: "conditions", amps: 20, degC: 35.0 },
      { at: 5600, type: "stage", title: "35.0 °C is Critical, exactly as before", detail: "The threshold acted at the right value.", tone: "alarm" },
      query(8000, CMD.COUNTERS),
      { at: 8100, type: "stage", title: "COUNTERS: 0 CRC rejects, 1 corrected, 0 uncorrectable", tone: "info" },
      { at: 9500, type: "stream", on: true },
      ...ramp("recover", 10000, { amps: 20, degC: 35.0 }, { amps: 20, degC: 30.0 }, 4000),
      { at: 14100, type: "acknowledge" },
    ],
  },
  {
    id: "ecc-two",
    name: "Two bits flip",
    moment: "Two bits of the Critical threshold flip at once.",
    summary: "Two bits cannot be repaired. On a perfectly normal 22.0 °C the chip refuses to guess and cuts power until the setting is rewritten.",
    testCase: "R9",
    steps: [
      { at: 100, type: "stream", on: false },
      { at: 600, type: "command", cmd: CMD.FLIP_TEST, data: 0x12 },
      { at: 700, type: "stage", title: "Two bits of the Critical threshold flipped", detail: "Self-test FLIP_TEST 0x12.", tone: "warn" },
      { at: 2500, type: "conditions", ...N },
      { at: 2600, type: "stage", title: "22.0 °C · setting unreadable · power-off", detail: "Fail-safe: an untrusted setting cannot protect the rack.", tone: "alarm" },
      { at: 5000, type: "press" },
      { at: 8500, type: "command", cmd: CMD.SET_CRIT, data: 70 },
      { at: 8600, type: "stage", title: "DCIM rewrites Critical = 35.0 °C", detail: "SET_CRIT 70 clears the fault.", tone: "info" },
      { at: 9000, type: "stream", on: true },
      { at: 9100, type: "acknowledge" },
      query(17000, CMD.TRIP_INFO),
    ],
  },
  // ------------------------------------------------------------------ reset and link
  {
    id: "held-button",
    name: "Taped reset button",
    moment: "Someone taped the reset button down.",
    summary: "P0 is held through a trip and recovery. A held button is not a new press: only release and press again resets.",
    testCase: "Extra",
    steps: [
      { at: 100, type: "hold" },
      { at: 300, type: "conditions", amps: 20, degC: 33.0 },
      ...ramp("conditions", 1200, { amps: 20, degC: 33.0 }, { amps: 20, degC: 35.0 }, 2400),
      { at: 3700, type: "stage", title: "Trip while P0 is held down", detail: "The held button is not a new press.", tone: "alarm" },
      ...ramp("recover", 6000, { amps: 20, degC: 35.0 }, { amps: 20, degC: 30.0 }, 4000),
      { at: 10500, type: "stage", title: "Safe to reset, but P0 is still held", detail: "A held button cannot clear the power-off.", tone: "warn" },
      { at: 13000, type: "release" },
      { at: 13000, type: "acknowledge", dwell: 1500 },
    ],
  },
  {
    id: "corrupt",
    name: "Noisy link",
    moment: "Interference damages a packet on the wire.",
    summary: "After a trip, a safe-looking 26.0 °C reading arrives with a damaged byte. Bad CRC (5A): it changes nothing.",
    testCase: "Extra",
    steps: [
      { at: 300, type: "conditions", amps: 20, degC: 33.0 },
      ...ramp("conditions", 1200, { amps: 20, degC: 33.0 }, { amps: 20, degC: 35.0 }, 2400),
      { at: 5500, type: "corrupt", degC: 26.0 },
      { at: 5600, type: "stage", title: "Damaged packet rejected (5A)", detail: "The safe-looking reading changed nothing. Power-off stays latched.", tone: "warn" },
      ...ramp("recover", 7500, { amps: 20, degC: 35.0 }, { amps: 20, degC: 30.0 }, 4000),
      { at: 11600, type: "acknowledge" },
    ],
  },
  {
    id: "invalid",
    name: "Bad input",
    moment: "A broken sensor and a typo in a setting.",
    summary: "A temperature of raw 0 and a Warm threshold above Hot are both rejected (3C). Nothing changes.",
    testCase: "Extra",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2500, type: "invalid" },
      { at: 2600, type: "stage", title: "Temperature raw 0 rejected (3C)", detail: "0 means no reading. Readings and outputs unchanged.", tone: "warn" },
      { at: 5500, type: "command", cmd: CMD.SET_WARM, data: 66 },
      { at: 5600, type: "stage", title: "Warm 33.0 °C rejected (3C)", detail: "It would break Warm < Hot < Critical.", tone: "warn" },
    ],
  },
  {
    id: "silent-leak",
    name: "Leak with the link down",
    moment: "The network is down when the leak starts.",
    summary: "Telemetry stops, then water reaches P1. The chip still cuts power, and P0 still works locally.",
    testCase: "Extra",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2000, type: "stream", on: false },
      { at: 2100, type: "stage", title: "Link silent · last state held", detail: "No telemetry, but P0 and P1 are still watched.", tone: "warn" },
      { at: 5000, type: "leak", wet: true },
      { at: 5100, type: "stage", title: "Leak caught without the network", detail: "Power-off latched from P1 alone.", tone: "alarm" },
      { at: 9000, type: "leak", wet: false },
      { at: 9100, type: "acknowledge", dwell: 2500 },
    ],
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Card label: "FPGA run R3", or "Extra". */
export const caseLabel = (s: Scenario) => (/^R\d/.test(s.testCase) ? `FPGA run ${s.testCase}` : "Extra");

/** Scenarios whose script includes an operator acknowledgement (a latched power-off is expected). */
export const needsAcknowledge = (s: Scenario) => s.steps.some((x) => x.type === "acknowledge");
