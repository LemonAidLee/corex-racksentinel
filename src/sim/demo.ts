/**
 * Guided demonstration: a fixed sequence of beats built from the same step vocabulary as the
 * scenarios. Moving forward plays a beat with animation; moving back rebuilds the state
 * instantly from a power-on reset, so any beat is reproducible.
 */
import type { SimulationRuntime } from "./runtime";
import type { ScenarioStep } from "./scenarios";

export interface DemoBeat {
  title: string;
  caption: string;
  /** Where the camera should look while this beat plays. */
  focus: "room" | "rack" | "desk" | "button";
  steps: ScenarioStep[];
}

const N = { amps: 25.4, degC: 26.5 };

export const DEMO_BEATS: DemoBeat[] = [
  {
    title: "Normal operation",
    caption: "The DCIM terminal streams voltage, current and temperature to RackSentinel. 26.5 °C and 25.4 A: no outputs requested.",
    focus: "room",
    steps: [{ at: 200, type: "conditions", ...N }],
  },
  {
    title: "The rack warms",
    caption: "At 27.0 °C the controller classifies the rack as Warm and raises P4, Fan Boost. Warm is an advisory band: no power request.",
    focus: "rack",
    steps: [{ at: 200, type: "conditions", amps: 25.4, degC: 27.0 }],
  },
  {
    title: "Critical heat",
    caption: "Above 32.0 °C is Critical. P5 requests maximum fans and P7 latches an Emergency Power-Off request on the first reading.",
    focus: "rack",
    steps: [{ at: 200, type: "conditions", amps: 25.4, degC: 32.5 }],
  },
  {
    title: "Cooling, still latched",
    caption: "The rack cools to 32.0 °C, which is Warm. Fans drop back to boost, but the EPO request stays latched.",
    focus: "rack",
    steps: [{ at: 200, type: "conditions", amps: 25.4, degC: 32.0 }],
  },
  {
    title: "Reset refused",
    caption: "The operator presses P0 too early. The controller checks the conditions: temperature is still Warm, so the reset is refused.",
    focus: "button",
    steps: [{ at: 200, type: "press" }],
  },
  {
    title: "Safe readings are not enough",
    caption: "Now 26.5 °C and 25.4 A: everything is Normal. The EPO request remains latched until a person acknowledges recovery.",
    focus: "rack",
    steps: [{ at: 200, type: "conditions", ...N }],
  },
  {
    title: "Operator acknowledges",
    caption: "A new P0 press with temperature Normal and current below 25.6 A: reset accepted, EPO request cleared.",
    focus: "button",
    steps: [{ at: 200, type: "press" }],
  },
  {
    title: "Current trip",
    caption: "Current rises to 32.2 A, above the 32.0 A trip level. P6 warns and P7 latches a new EPO request. Trip count: 2.",
    focus: "rack",
    steps: [{ at: 200, type: "conditions", amps: 32.2, degC: 25.0 }],
  },
  {
    title: "Corrupted message",
    caption: "A safe-looking reading arrives with a bad CRC. It is rejected with 0x5A and cannot clear the EPO request.",
    focus: "desk",
    steps: [{ at: 200, type: "corrupt", ...N }],
  },
  {
    title: "Recovery, acknowledged",
    caption: "Current returns to 25.4 A. The operator presses P0 once more and the controller accepts the reset. Danger is sticky; safety must be earned.",
    focus: "button",
    steps: [
      { at: 200, type: "conditions", amps: 25.4, degC: 25.0 },
      { at: 2200, type: "press" },
    ],
  },
];

export class GuidedDemo {
  index = -1;
  constructor(private rt: SimulationRuntime) {}

  get beat(): DemoBeat | null {
    return this.index >= 0 ? DEMO_BEATS[this.index] : null;
  }

  start(): void {
    this.rt.restart({ streaming: false }); // the demo drives every packet itself
    this.index = -1;
    this.next();
  }

  stop(): void {
    this.index = -1;
  }

  next(): void {
    if (this.index >= DEMO_BEATS.length - 1) return;
    this.rt.flushTasks(); // finish the current beat before starting the next
    this.index++;
    for (const step of DEMO_BEATS[this.index].steps) this.rt.schedule(step.at, () => this.rt.runStep(step, false));
  }

  previous(): void {
    if (this.index <= 0) return;
    this.goTo(this.index - 1);
  }

  /** Rebuild the controller state at the end of beat `i`, instantly and silently. */
  goTo(i: number): void {
    this.rt.restart({ streaming: false });
    this.rt.applyInstant(DEMO_BEATS.slice(0, i + 1).flatMap((b) => b.steps));
    this.index = i;
  }
}
