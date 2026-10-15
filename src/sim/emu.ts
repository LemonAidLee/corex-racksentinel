/**
 * The organisers' `./emu` command line, interpreted against the controller model.
 *
 * Option meanings (RVBL-Emulator, stage3_soc/organiser_reference/RVBL-Emulator/src/emu.c):
 *   -d V   pin directions (0xF0: P7..P4 outputs, P3..P0 inputs driven by the emulator)
 *   -i V   drive the input pins (bit 0 = P0 reset, bit 1 = P1 leak)
 *   -t4 V  send four bytes to the chip's UART, least-significant byte first
 *   -r1 V / -r4 V  read 1 or 4 reply bytes and compare
 *   -o V   read the output pins and compare
 * Replies are consumed in order: a -t4 that produces four bytes is followed by -r4.
 */
import { RackSentinelController, type ControllerState, type Note, type ResetOutcome } from "./controller";
import { replyValue } from "./protocol";

export type EmuOp = "d" | "i" | "o" | "t1" | "t2" | "t4" | "r1" | "r2" | "r4";

export interface EmuToken {
  op: EmuOp;
  value: number;
  /** The token as written, e.g. "-t4 0xFE072C20". */
  arg: string;
}

export interface EmuStep extends EmuToken {
  /** For -t4: the four bytes on the wire, in transmission order. */
  frame?: number[];
  /** For -r: the bytes the chip actually sent. For -o: the pin byte actually read. */
  actual?: number;
  /** For -r and -o: the expected value matched. */
  ok?: boolean;
  /** For -i: the P0 evaluation, if any. */
  reset?: ResetOutcome | null;
  notes: Note[];
  /** Controller state after this step. */
  state: ControllerState;
}

export function parseEmu(line: string): EmuToken[] {
  const parts = line.trim().split(/\s+/).filter((p) => p !== "./emu");
  const out: EmuToken[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const op = parts[i].replace(/^-/, "") as EmuOp;
    const value = parseInt(parts[i + 1], 16) >>> 0;
    out.push({ op, value, arg: `${parts[i]} ${parts[i + 1]}` });
  }
  return out;
}

export interface EmuRun {
  steps: EmuStep[];
  /** Every -r and -o step matched. */
  passed: boolean;
  /** Index of the first mismatch, or -1. */
  firstFailure: number;
}

/** Run an `./emu` line on a fresh controller (the chip is reset before every run). */
export function runEmu(line: string, controller = new RackSentinelController()): EmuRun {
  controller.reset();
  const steps: EmuStep[] = [];
  let pending: number[] = [];
  let firstFailure = -1;
  for (const t of parseEmu(line)) {
    const step: EmuStep = { ...t, notes: [], state: controller.snapshot() };
    switch (t.op) {
      case "d":
        break;
      case "i": {
        const r = controller.setInputs({ reset: !!(t.value & 1), leak: !!(t.value & 2) });
        step.reset = r.reset;
        step.notes = r.notes;
        break;
      }
      case "t4": {
        const frame = [t.value & 0xff, (t.value >>> 8) & 0xff, (t.value >>> 16) & 0xff, (t.value >>> 24) & 0xff];
        const r = controller.receiveFrame(frame);
        step.frame = frame;
        step.notes = r.notes;
        pending = pending.concat(r.reply);
        break;
      }
      case "r1":
      case "r2":
      case "r4": {
        const n = Number(t.op.slice(1));
        const bytes = pending.slice(0, n);
        pending = pending.slice(n);
        step.actual = replyValue(bytes);
        step.ok = bytes.length === n && step.actual === t.value;
        break;
      }
      case "o":
        step.actual = controller.pins & 0xf0;
        step.ok = step.actual === t.value;
        break;
      default:
        break;
    }
    step.state = controller.snapshot();
    if (step.ok === false && firstFailure < 0) firstFailure = steps.length;
    steps.push(step);
  }
  return { steps, passed: firstFailure < 0, firstFailure };
}
