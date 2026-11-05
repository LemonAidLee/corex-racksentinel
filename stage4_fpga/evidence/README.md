# AWS FPGA evidence (2026-10-10)

RackSentinel v2 on the AWS FPGA, built with the organizer's unmodified `top.sv` and
`CoreX/aws/riscv.sv` (core clock 250 MHz / 8).

| File | What it shows |
|---|---|
| `synthesis_log_2026-10-10.txt` | Full Vivado 2024.1 build log: 0 errors; routed timing WNS +0.711 ns, WHS +0.013 ns; "SUCCESS: Design has no negative slack path" |
| `afi_available.png` | The image `afi-0d0eb57f78ad69e3b` / `agfi-0a4f37f7744a84a88` in state `available` |
| `load_and_reset.png` | Clear, load and manual reset, as in the organizer's guide |
| `fpga_emu_R1.png` … `fpga_emu_R9.png` | The nine `./emu` runs of `apps/rack_sentinel/emu_runs.txt` on the FPGA: every step `[ok]` |

Notes on the log:

- The 16 "Converted tricell instance to logic" critical warnings are expected: an FPGA has no
  internal tristate wires, so Vivado turns the `io_Pins` tristates (theirs in `top.sv`, ours in
  the eight Inout Pins) into ordinary logic. The organizer's reference design does the same.
- The other critical warnings come from the AWS shell's own constraint files, not our design.
- Vivado inserted a global clock buffer on our divided clock (`w_Core_Clk`, 1,191 loads). The
  reported slack is for the 250 MHz clock; the divided clock has no constraint of its own in
  this flow, so the tool does not time the core's paths. They have 32 ns per cycle, and the nine
  runs passing on the hardware is the evidence that this is enough.
