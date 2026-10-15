/**
 * Guided demonstration: Ali's shift as a fixed sequence of beats, built from the same step
 * vocabulary as the scenarios. Moving forward plays a beat with animation; moving back rebuilds
 * the state instantly from a power-on reset, so any beat is reproducible.
 */
import type { SimulationRuntime } from "./runtime";
import { ramp, type ScenarioStep } from "./scenarios";
import { CMD } from "./protocol";

export interface DemoBeat {
  title: string;
  /** The one line the audience reads: short enough to take in at a glance. */
  say: string;
  /** The supporting detail, for the presenter and for anyone reading closely. */
  caption: string;
  /** Where the camera should look while this beat plays. */
  focus: "room" | "rack" | "desk" | "button";
  /**
   * The single panel the audience should be looking at. Everything else in the HUD steps back
   * while the beat plays, so four panels never compete for the same pair of eyes.
   */
  anchor: "rack" | "status" | "telemetry" | "ribbon";
  /** The rehearsed FPGA run this beat matches, shown as a badge so the twin ties to the hardware. */
  run?: string;
  steps: ScenarioStep[];
}

const A = 20.0;

export const DEMO_BEATS: DemoBeat[] = [
  {
    title: "Morning check",
    say: "A healthy rack: 22 °C, 20 A, nothing to do.",
    caption: "Ali starts the shift. The DCIM sends TEMP and CURRENT packets: 22.0 °C and 20.0 A, 4.6 kW. Every packet is checked with the custom crcb instruction. No outputs requested.",
    focus: "room",
    anchor: "telemetry",
    run: "R1",
    steps: [{ at: 200, type: "conditions", amps: A, degC: 22.0 }],
  },
  {
    title: "The hall warms",
    say: "27 °C — Warm. The chip boosts the fans.",
    caption: "The rack climbs 0.5 °C at a time. At 27.0 °C, the top of the ASHRAE recommended range, it is Warm and P4 boosts the fans.",
    focus: "rack",
    anchor: "rack",
    run: "R2",
    steps: ramp("conditions", 200, { amps: A, degC: 22.0 }, { amps: A, degC: 27.0 }, 2400),
  },
  {
    title: "Hot afternoon",
    say: "32 °C — Hot. Fans to maximum, power stays on.",
    caption: "At 32.0 °C the rack is Hot: P5 runs the fans at maximum. Still no power-off: the chip only cuts power when the rack is in real danger.",
    focus: "rack",
    anchor: "rack",
    run: "R2",
    steps: ramp("conditions", 200, { amps: A, degC: 27.0 }, { amps: A, degC: 32.0 }, 2400),
  },
  {
    title: "Critical: power-off",
    say: "35 °C — Critical. The chip cuts the power and records why.",
    caption: "At 35.0 °C the rack is Critical. P7 latches the emergency power-off and the chip saves a trip record: cause, temperature and current.",
    focus: "rack",
    anchor: "status",
    run: "R3",
    steps: ramp("conditions", 200, { amps: A, degC: 32.0 }, { amps: A, degC: 35.0 }, 1800),
  },
  {
    title: "Reset refused",
    say: "Ali presses reset too early. Refused: the rack is still Critical.",
    caption: "Ali presses P0 too early. The chip checks every cause again: the rack is still Critical, so the reset is refused.",
    focus: "button",
    anchor: "status",
    run: "R3",
    steps: [{ at: 200, type: "press" }],
  },
  {
    title: "Cooling, still latched",
    say: "Cooler now — but the power-off stays latched.",
    caption: "The rack cools to 30.0 °C. The fans drop to boost, but the power-off stays latched: safe readings alone never switch a rack back on.",
    focus: "rack",
    anchor: "status",
    run: "R3",
    steps: ramp("recover", 200, { amps: A, degC: 35.0 }, { amps: A, degC: 30.0 }, 2400),
  },
  {
    title: "Ali acknowledges",
    say: "Ali presses again. Accepted: a human closed the incident.",
    caption: "A new P0 press with the rack below Critical: reset accepted, power-off cleared. P4 keeps the fans boosted while the rack is still Warm.",
    focus: "button",
    anchor: "status",
    run: "R3",
    steps: [{ at: 200, type: "press" }],
  },
  {
    title: "Water under the floor",
    say: "Water on the sensor. Power cut instantly, with no network message.",
    caption: "A pipe leaks onto the sensor on P1. The chip watches P1 by itself and cuts power at once, with no message on the network.",
    focus: "rack",
    anchor: "rack",
    run: "R5",
    steps: [{ at: 200, type: "leak", wet: true }],
  },
  {
    title: "Dry, then reset",
    say: "Drying it is not enough. Ali presses P0 and the rack comes back.",
    caption: "Drying the sensor is not enough. Once P1 is dry, Ali presses P0 and the chip accepts the reset.",
    focus: "button",
    anchor: "status",
    run: "R5",
    steps: [
      { at: 200, type: "leak", wet: false },
      { at: 1800, type: "press" },
    ],
  },
  {
    title: "A memory fault",
    say: "Two bits of a threshold flip. The chip refuses to guess, and cuts power.",
    caption: "Two bits of the Critical threshold flip in memory. The error-correcting code cannot repair two bits, so on the next reading the chip refuses to guess and cuts power.",
    focus: "rack",
    anchor: "ribbon",
    run: "R9",
    steps: [
      { at: 200, type: "command", cmd: CMD.FLIP_TEST, data: 0x12 },
      { at: 1200, type: "conditions", amps: A, degC: 30.0 },
    ],
  },
  {
    title: "Rewrite and recover",
    say: "The setting is rewritten, the reset accepted. Safety has to be earned.",
    caption: "The DCIM rewrites Critical = 35.0 °C, which clears the fault. Ali presses P0 and the rack is back. Danger is sticky; safety must be earned.",
    focus: "button",
    anchor: "status",
    run: "R9",
    steps: [
      { at: 200, type: "command", cmd: CMD.SET_CRIT, data: 70 },
      { at: 1800, type: "press" },
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
