#!/usr/bin/env bash
# Replay ./emu command lines on the simulated RackSentinel SoC
# (../rtl/hdl/hdl_application.v) with emu_sim.py and Icarus Verilog.
#
#   ./emu.sh -d 0xF0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0   # one run
#   ./emu.sh --all                                               # every run in emu_runs.txt
#
# Requires: python3, iverilog, vvp.  Set PYTHON=python if python3 is not on PATH.
set -eu
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
mkdir -p build

# emu_sim.py drives one 8-bit pins_io bus; the ChipInventor top exposes eight
# scalar pins (pins_io_0 .. pins_io_7), so wrap the exported top once.
"$PY" - <<'PY'
d = open("../rtl/hdl/hdl_application.v").read().replace("module top (", "module top_pins8 (", 1)
d += """
module top (input wire clk_i, input wire rst_i, input wire rx_i, output wire tx_o, inout wire [7:0] pins_io);
    top_pins8 u (.clk_i(clk_i), .rst_i(rst_i), .rx_i(rx_i), .tx_o(tx_o),
        .pins_io_0(pins_io[0]), .pins_io_1(pins_io[1]), .pins_io_2(pins_io[2]), .pins_io_3(pins_io[3]),
        .pins_io_4(pins_io[4]), .pins_io_5(pins_io[5]), .pins_io_6(pins_io[6]), .pins_io_7(pins_io[7]));
endmodule
"""
open("build/emu_design.v", "w").write(d)
PY

if [ "${1:-}" = "--all" ]; then
  exec "$PY" emu_sim.py --design build/emu_design.v --file emu_runs.txt
fi
exec "$PY" emu_sim.py --design build/emu_design.v ./emu "$@"
