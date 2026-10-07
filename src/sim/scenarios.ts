/**
 * Scenario definitions. Every scenario is a deterministic, timed list of steps that starts
 * from a controller power-on reset, like every case in tb_data_center_application.v.
 * `testCase` links each scenario to the evidence; it is not shown to normal users.
 * Values are real units; they are converted to raw steps exactly (0.2 A, 0.5 °C).
 *
 * Recovery is always external: RackSentinel only measures the rack and requests outputs.
 * P5 asks for maximum fans but does not change the reading; temperature changes only when
 * the simulated environment sends a new sample through the DCIM terminal (`recover`).
 * A latched EPO request is cleared only by the operator's new P0 press (`acknowledge`).
 */
import type { NoticeTone } from "./events";

export interface Conditions {
  volts: number;
  amps: number;
  degC: number;
}

export type ScenarioStep =
  /** External rack conditions change; the DCIM terminal sends them immediately. */
  | { at: number; type: "conditions"; volts?: number; amps: number; degC: number }
  /** Simulated external recovery: the rack environment improves and the DCIM sends the new reading. */
  | { at: number; type: "recover"; volts?: number; amps: number; degC: number }
  /** Send the current conditions with a corrupted CRC (low bit flipped, as in the testbench). */
  | { at: number; type: "corrupt"; amps: number; degC: number }
  /** Send a reading the controller must reject: temperature raw value 0 (sensor fault). */
  | { at: number; type: "invalid" }
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
   * Recovery phase: once the controller reports safe readings with the EPO still latched, wait
   * `dwell` ms so the latch is visible, then send the operator to make a new P0 press.
   * The operator only goes when a reset is logically appropriate (see RecoveryCoordinator).
   */
  | { at: number; type: "acknowledge"; dwell?: number };

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  testCase: string;
  steps: ScenarioStep[];
}

const N = { amps: 25.4, degC: 26.5 }; // Normal reading used by the test cases


export const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    name: "Normal Rack",
    summary: "230 V, 25.4 A, 26.5 °C. No outputs requested.",
    testCase: "C01",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 600, type: "stage", title: "Normal readings", detail: "No outputs requested. Nothing to reset.", tone: "ok" },
    ],
  },
  {
    id: "warm",
    name: "Warm Rack",
    summary: "27.0 °C starts Warm (P4 fan boost). Exactly 32.0 °C is still Warm.",
    testCase: "C02",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2500, type: "conditions", amps: 25.4, degC: 27.0 },
      { at: 2600, type: "stage", title: "Warm at 27.0 °C · fan boost (P4)", detail: "Advisory band. No EPO request.", tone: "warn" },
      { at: 6500, type: "conditions", amps: 25.4, degC: 32.0 },
      { at: 6600, type: "stage", title: "Exactly 32.0 °C is still Warm", detail: "Fan boost only. Critical starts at 32.5 °C.", tone: "warn" },
      { at: 7200, type: "note", title: "Exactly 32.0 °C is still Warm", detail: "Fan boost only. No EPO request below 32.5 °C.", tone: "info" },
      { at: 11000, type: "recover", ...N },
    ],
  },
  {
    id: "critical-heat",
    name: "Critical Heat",
    summary: "32.5 °C is Critical: maximum fans and an EPO request. External recovery, then the operator acknowledges.",
    testCase: "C03",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 3000, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 7000, type: "recover", amps: 25.4, degC: 32.0 },
      { at: 10500, type: "recover", ...N },
      { at: 10500, type: "acknowledge" },
    ],
  },
  {
    id: "current-warning",
    name: "Current Warning",
    summary: "25.6 A and exactly 32.0 A raise the P6 current warning, without an EPO request.",
    testCase: "C04",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 25.0 },
      { at: 2500, type: "conditions", amps: 25.6, degC: 25.0 },
      { at: 2600, type: "stage", title: "Current warning at 25.6 A (P6)", detail: "Warning only. No EPO request.", tone: "warn" },
      { at: 6500, type: "conditions", amps: 32.0, degC: 25.0 },
      { at: 6600, type: "stage", title: "Exactly 32.0 A is still a warning", detail: "Only current above 32.0 A requests EPO.", tone: "warn" },
      { at: 7200, type: "note", title: "Exactly 32.0 A is still a warning", detail: "Only current above 32.0 A requests EPO.", tone: "info" },
      { at: 11000, type: "recover", amps: 25.4, degC: 25.0 },
    ],
  },
  {
    id: "current-trip",
    name: "Current Trip",
    summary: "32.2 A trips: current warning plus a latched EPO request. Reset stays blocked at 32.0 A.",
    testCase: "C05",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 25.0 },
      { at: 3000, type: "conditions", amps: 32.2, degC: 25.0 },
      { at: 7000, type: "recover", amps: 32.0, degC: 25.0 },
      { at: 11000, type: "recover", amps: 25.4, degC: 25.0 },
      { at: 11000, type: "acknowledge" },
    ],
  },
  {
    id: "combined",
    name: "Combined Danger",
    summary: "Heat and overcurrent together. Either fault alone keeps the EPO request.",
    testCase: "C06",
    steps: [
      { at: 300, type: "conditions", ...N },
      { at: 2500, type: "conditions", amps: 32.2, degC: 32.5 },
      { at: 2600, type: "stage", title: "Critical heat and current trip", detail: "Either fault alone is enough to latch P7.", tone: "alarm" },
      { at: 6500, type: "recover", amps: 32.2, degC: 25.0 },
      { at: 7200, type: "stage", title: "Temperature recovered, current still trips", detail: "The current fault alone keeps the EPO request. No reset yet.", tone: "alarm" },
      { at: 7400, type: "note", title: "Either fault alone is enough", detail: "The EPO request stayed latched through the change.", tone: "info" },
      { at: 11000, type: "recover", amps: 25.4, degC: 25.0 },
      { at: 11000, type: "acknowledge" },
    ],
  },
  {
    id: "recover",
    name: "Conditions Recover",
    summary: "After a heat trip the rack cools to Normal, but the EPO request stays latched until P0.",
    testCase: "C08",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 4500, type: "recover", amps: 25.4, degC: 32.0 },
      { at: 8500, type: "recover", ...N },
      { at: 10500, type: "note", title: "Safe readings alone did not clear it", detail: "P7 is still latched. Only a new P0 press can acknowledge recovery.", tone: "warn" },
      { at: 8500, type: "acknowledge", dwell: 3500 },
    ],
  },
  {
    id: "reset-warm",
    name: "Reset While Warm",
    summary: "P0 is pressed while the rack is still Warm and refused. Once Normal, a new press is accepted.",
    testCase: "C11",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 4000, type: "recover", amps: 25.4, degC: 27.0 },
      { at: 5000, type: "press" },
      { at: 12500, type: "recover", ...N },
      { at: 12500, type: "acknowledge" },
    ],
  },
  {
    id: "reset-current",
    name: "Reset During Current Warning",
    summary: "P0 is pressed at 25.6 A and refused. Once below 25.6 A, a new press is accepted.",
    testCase: "C09",
    steps: [
      { at: 300, type: "conditions", amps: 32.2, degC: 25.0 },
      { at: 4000, type: "recover", amps: 25.6, degC: 25.0 },
      { at: 5000, type: "press" },
      { at: 12500, type: "recover", amps: 25.4, degC: 25.0 },
      { at: 12500, type: "acknowledge" },
    ],
  },
  {
    id: "held-button",
    name: "Held Reset Button",
    summary: "P0 is stuck down through a trip and recovery. Only a release and a new press can reset.",
    testCase: "C12",
    steps: [
      { at: 100, type: "hold" },
      { at: 1500, type: "conditions", amps: 32.2, degC: 25.0 },
      { at: 1600, type: "stage", title: "Trip while P0 is held down", detail: "The held button is not a new press.", tone: "alarm" },
      { at: 5500, type: "recover", amps: 25.4, degC: 25.0 },
      { at: 6200, type: "stage", title: "Safe readings, but P0 is still held", detail: "A held button cannot clear the EPO request.", tone: "warn" },
      { at: 10000, type: "release" },
      { at: 11500, type: "acknowledge", dwell: 1500 },
    ],
  },
  {
    id: "invalid",
    name: "Invalid Telemetry",
    summary: "A reading with temperature raw 0 is rejected (0x3C). Nothing changes until a valid sample arrives.",
    testCase: "C10",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 4000, type: "invalid" },
      { at: 4100, type: "stage", title: "Invalid reading rejected (0x3C)", detail: "Readings, outputs and the EPO latch are unchanged.", tone: "warn" },
      { at: 8500, type: "recover", ...N },
      { at: 8500, type: "acknowledge" },
    ],
  },
  {
    id: "corrupt",
    name: "Corrupted Message",
    summary: "A safe-looking reading with a bad CRC is rejected (0x5A). Only a valid sample and P0 can recover.",
    testCase: "C10",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 4000, type: "corrupt", ...N },
      { at: 4100, type: "stage", title: "Corrupted message rejected (0x5A)", detail: "The safe-looking packet changed nothing. EPO stays latched.", tone: "warn" },
      { at: 8500, type: "recover", ...N },
      { at: 8500, type: "acknowledge" },
    ],
  },
  {
    id: "no-telemetry",
    name: "No Telemetry",
    summary: "The link goes silent. The controller holds its last state; P0 still works locally.",
    testCase: "§16 Q&A",
    steps: [
      { at: 300, type: "conditions", amps: 25.4, degC: 32.5 },
      { at: 4000, type: "recover", ...N },
      { at: 5500, type: "stream", on: false },
      { at: 5600, type: "stage", title: "Link silent · last state held", detail: "No new telemetry. P0 still works locally.", tone: "warn" },
      { at: 5600, type: "acknowledge", dwell: 2500 },
    ],
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Scenarios whose script includes an operator acknowledgement (a latched EPO is expected). */
export const needsAcknowledge = (s: Scenario) => s.steps.some((x) => x.type === "acknowledge");
