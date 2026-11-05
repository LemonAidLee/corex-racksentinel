# 15 · Limitations, open items and next steps

> [!NOTE]
> **After this chapter you will know**
> Exactly what we do **not** claim, which items are still open, and a realistic list of next steps.

## What we claim, and what backs it

| Claim | Backed by |
|---|---|
| The CPU is correct | Stage 2 firmware self-test PASS |
| The CPU is manufacturable | OpenLane: DRC 0, LVS clean, timing met at 25 MHz |
| GPIO and UART are correct | Organisers' test firmware, 20 checks |
| RackSentinel v2 behaves as specified | 524 testbench checks; 1,000 demo cases in simulation |
| The tests catch real faults | Mutation: 23 of 23 (v2), 4 of 4 (v1) |
| Corrupted packets are caught | CRC: 18,472 patterns, 0 missed |
| **It works on real hardware** | **9 of 9 `./emu` runs on the AWS FPGA** |

## What we do not claim

> [!CAUTION]
> **Be straight about these**
> - **Only R1 to R9 ran on the FPGA.** The 1,000 random demo cases were checked in simulation.
> - **The 31.25 MHz core clock is not timing-constrained** in the AWS flow. The reported slack (+0.711 ns) is for the 250 MHz shell clock. The passing hardware runs are the evidence for the core.
> - **The v2 test numbers (524 checks, 23 mutants) come from the team's CoreX source repository**, which is not in this workspace.
> - **The OpenLane GDSII used a placeholder ROM and RAM.** It proves the CPU can be manufactured, not the full SoC with firmware.
> - **Voltage is a setting**, not a measurement.
> - **High current raises an alarm but does not cut the power.**
> - **Digital layer only.** Real sensors, fan drivers, contactors and electrical isolation are out of scope; P7 is a power-off request.
> - **One rack per controller.**

## Open items

| # | Item | Impact | Action |
|---|---|---|---|
| 1 | ~~The digital twin still models v1~~ | Resolved 2026-10-13 | The twin now runs the v2 model, checked against R1 to R9 and the 1,000 RTL cases, and has `/features` and `/data-flow` pages |
| 2 | Source files referenced in `stage4_fpga/README.md` are not in this workspace (`rack_sentinel.s`, testbenches, `verify_demo.py`, `DEMO.md`) | Medium: v2 numbers cannot be rerun here | Link the CoreX source repository |
| 3 | the CoreX repository's README calls the Stage 3 version "v1 with ECC on a temperature log"; the submitted Stage 3 package has no ECC | Medium: a wrong claim in Q&A | Until confirmed, say ECC is new in v2 |
| 4 | Unconstrained core clock (above) | Low | Prepare the answer; a `create_generated_clock` constraint would close it |
| 5 | Packet-fragment timeout is about 8 s on the FPGA (SPEC says 1.0 s at 250 MHz) | Low: `./emu` sends whole packets | Quote "about 8 s on the FPGA" if asked |

## Next steps

| Step | Why it is worth doing | Effort |
|---|---|---|
| Constrain the divided core clock | Let Vivado prove the core's timing, not only the shell's | Small |
| Measure voltage instead of setting it | Under- and over-voltage protection; real power factor | Small (one more packet type) |
| Hardware watchdog timer | Recover automatically if the firmware ever hangs | Medium (new peripheral) |
| Interrupts instead of polling | Faster reaction to P0 and P1; lower power | Medium (CPU change) |
| ECC on all of DMEM, in hardware | Protect every variable, not only the nine settings words | Medium |
| Several racks per controller | One chip watching a row of racks, more inputs on more pins | Medium |
| Time-stamped trip log | Several trips kept, not only the first; useful for incident reviews | Small |
| Tape-out the full SoC with OpenLane | Extend the Stage 2 physical design to the complete RackSentinel chip | Large |

