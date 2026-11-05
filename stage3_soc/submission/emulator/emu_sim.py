#!/usr/bin/env python3
"""Run an ./emu command line against the RTL in simulation (iverilog).

The organizer's ./emu (RVBL-Emulator/src/emu.c) only runs on the AWS FPGA. This
tool replays the same options, in the same order and with the same meaning, at
the chip pins of a simulated design, and prints emu-style [ok]/[error] lines:

    ./emu.sh -d 0xF0 -t4 0x357FE65A -t2 0xF550 -r1 0xA5 -o 0x00   (wraps the design, then calls this tool)
    python3 emu_sim.py --design build/emu_design.v ./emu -d 0xF0 ...

Behaviour copied from emu.c:
  * start: reset the chip, direction 0x01, inputs 0 ("[ok] RISC-V started!");
  * -d DIR   bit = 1: the emulator releases that pin and observes the chip;
             bit = 0: the emulator drives it with the -i value;
  * -i DATA  drive the pins whose direction bit is 0;
  * -o DATA  OUT (the observed pins; driven pins read 0) must equal DATA;
  * -tN V    send N bytes to the chip's rx_i, least-significant byte first;
  * -rN V    take the next N bytes the chip sent on tx_o since reset (first
             8 bytes captured, first byte = least significant) and compare;
  * stop at the first error.
Timing is compressed: emu.c sleeps 50 ms before every register access (so
-t4 bytes arrive >= 100 ms apart on the 250 MHz FPGA); here each step waits
--step-us and bytes are --gap-us apart at 25 MHz. The firmware waits up to
12,500,992 polls per byte, far longer than the real 100 ms emulator spacing.

Options: --design FILE (default build/emu_design.v, created by emu.sh from
../rtl/hdl/hdl_application.v), --vcd FILE, --step-us N (default 1000),
--gap-us N (default 1000), --file F (run every "./emu ..." line of F,
e.g. emu_runs.txt).
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
EMU_OPT = re.compile(r"^-(d|i|o|t1|t2|t4|r1|r2|r4)$")


def parse_emu(argv):
    """['./emu', '-d', '0xF0', ...] -> [('d', 0xF0), ...] in order."""
    args = [a for a in argv if a not in ("./emu", "emu")]
    steps = []
    i = 0
    while i < len(args):
        m = EMU_OPT.match(args[i])
        if not m or i + 1 >= len(args):
            sys.exit(f"emu_sim: cannot parse '{args[i]}' (expected -d/-i/-o/-t1/-t2/-t4/-r1/-r2/-r4 VALUE)")
        steps.append((m.group(1), int(args[i + 1], 0)))
        i += 2
    if not steps:
        sys.exit("emu_sim: no ./emu options given")
    return steps


def testbench(steps, step_us, gap_us, vcd):
    lines = []
    for op, v in steps:
        if op == "d":
            lines.append(f"        emu_dir(8'h{v & 0xFF:02X});")
        elif op == "i":
            lines.append(f"        emu_in(8'h{v & 0xFF:02X});")
        elif op == "o":
            lines.append(f"        emu_out(32'h{v & 0xFFFFFFFF:08X});")
        elif op[0] == "t":
            n = int(op[1])
            lines.append(f"        emu_tx({n}, 32'h{v & 0xFFFFFFFF:08X});")
        else:
            n = int(op[1])
            lines.append(f"        emu_rx({n}, 32'h{v & 0xFFFFFFFF:08X});")
    dump = f'$dumpfile("{vcd}"); $dumpvars(0, testbench.rx, testbench.tx, testbench.pins_io);' if vcd else ""
    return f"""`timescale 1ns / 1ps
module testbench();
    localparam integer CLK_NS = 40;                 // 25 MHz
    localparam real    BIT_NS = 217 * CLK_NS;       // 115200 baud, divisor 217
    localparam real    STEP_NS = {step_us * 1000.0};
    localparam real    GAP_NS  = {gap_us * 1000.0};

    reg clk = 0, rst = 1;
    always #(CLK_NS / 2) clk = ~clk;
    reg rx = 1'b1;
    wire tx;
    wire [7:0] pins_io;
    reg [7:0] dir = 8'h01, drive = 8'h00;           // emu.c init: direction 0x01
    genvar g;
    generate for (g = 0; g < 8; g = g + 1) begin : pad
        assign pins_io[g] = dir[g] ? 1'bz : drive[g];
    end endgenerate

    top DUT (.clk_i(clk), .rst_i(rst), .rx_i(rx), .tx_o(tx), .pins_io(pins_io));

    // Capture everything the chip sends (emu.c reads the first 8 bytes).
    reg [7:0] cap [0:7];
    integer ncap = 0, rptr = 0, k;
    reg [7:0] b;
    always begin
        @(negedge tx);
        #(BIT_NS / 2.0);
        if (tx === 1'b0) begin
            for (k = 0; k < 8; k = k + 1) begin #(BIT_NS) b[k] = tx; end
            #(BIT_NS);
            if (ncap < 8) cap[ncap] = b;
            ncap = ncap + 1;
        end
    end

    task fail; begin $display("emu_sim: RESULT FAIL"); $finish; end endtask
    task settle; #(STEP_NS); endtask

    task emu_dir(input [7:0] v);
        begin settle; dir = v; $display("[ok] Written 0x%08X to DIRECTION", v); end
    endtask
    task emu_in(input [7:0] v);
        begin settle; drive = v; $display("[ok] Written 0x%08X to INPUT PINS", v); end
    endtask
    task emu_out(input [31:0] want);
        reg [31:0] got;
        integer j;
        begin
            settle;
            got = 0;
            for (j = 0; j < 8; j = j + 1) got[j] = dir[j] ? pins_io[j] : 1'b0;
            if (got !== want) begin
                $display("[error] OUT read error. Expected 0x%08X. Got 0x%08X", want, got);
                fail;
            end
            $display("[ok] Read 0x%08X from OUTPUT PINS", got);
        end
    endtask
    task emu_tx(input integer n, input [31:0] v);
        integer i, j;
        begin
            settle;
            for (i = 0; i < n; i = i + 1) begin
                if (i > 0) #(GAP_NS);
                rx = 1'b0; #(BIT_NS);
                for (j = 0; j < 8; j = j + 1) begin rx = v[8*i + j]; #(BIT_NS); end
                rx = 1'b1; #(BIT_NS);
            end
            case (n)
                1: $display("[ok] Written 0x%02X to UART RX", v[7:0]);
                2: $display("[ok] Written 0x%04X to UART RX", v[15:0]);
                default: $display("[ok] Written 0x%08X to UART RX", v);
            endcase
        end
    endtask
    task emu_rx(input integer n, input [31:0] want);
        reg [31:0] got;
        integer i;
        begin
            settle;
            if (rptr + n > 8) begin $display("[error] \\"fpga_read_uart\\" error: 1"); fail; end
            got = 0;
            for (i = 0; i < n; i = i + 1)
                got[8*i +: 8] = (rptr + i < ncap) ? cap[rptr + i] : 8'h00;
            if (rptr + n > ncap)
                $display("  (emu_sim: only %0d byte(s) had arrived; missing bytes read as 0x00)", ncap);
            rptr = rptr + n;
            if (got !== want) begin
                case (n)
                    1: $display("[error] UART read error. Expected 0x%02X. Got 0x%02X", want[7:0], got[7:0]);
                    2: $display("[error] UART read error. Expected 0x%04X. Got 0x%04X", want[15:0], got[15:0]);
                    default: $display("[error] UART read error. Expected 0x%08X. Got 0x%08X", want, got);
                endcase
                fail;
            end
            case (n)
                1: $display("[ok] Read 0x%02X from UART TX", got[7:0]);
                2: $display("[ok] Read 0x%04X from UART TX", got[15:0]);
                default: $display("[ok] Read 0x%08X from UART TX", got);
            endcase
        end
    endtask

    initial begin
        {dump}
        repeat (4) @(posedge clk);
        @(negedge clk) rst = 1'b0;
        $display("[ok] RISC-V started!");
{chr(10).join(lines)}
        $display("emu_sim: RESULT PASS (%0d byte(s) received from the chip)", ncap);
        $finish;
    end
endmodule
"""


def run(argv, design, vcd, step_us, gap_us):
    steps = parse_emu(argv)
    print("$ ./emu " + " ".join(a for a in argv if a not in ("./emu", "emu")))
    print(f"  (simulated on {os.path.relpath(design)})")
    with tempfile.TemporaryDirectory() as d:
        tb = os.path.join(d, "emu_tb.v")
        with open(tb, "w") as f:
            f.write(testbench(steps, step_us, gap_us, os.path.abspath(vcd) if vcd else None))
        exe = os.path.join(d, "sim.out")
        c = subprocess.run(["iverilog", "-g2012", "-o", exe, tb, design], capture_output=True, text=True)
        if c.returncode:
            sys.exit("emu_sim: compile failed\n" + c.stdout + c.stderr)
        r = subprocess.run(["vvp", "-n", exe], capture_output=True, text=True, cwd=d)
        out = [re.sub(r"0x([0-9a-fA-F]+)", lambda m: "0x" + m.group(1).upper(), l)
               for l in r.stdout.splitlines() if not l.startswith("VCD info") and "$finish" not in l]
        print("\n".join(out))
        return any("RESULT PASS" in l for l in out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 usage="emu_sim.py [--design F] [--vcd F] [--step-us N] [--gap-us N] "
                                       "(./emu OPTIONS... | --file F)")
    ap.add_argument("--design", default=os.path.join(HERE, "build", "emu_design.v"))
    ap.add_argument("--vcd", default=None)
    ap.add_argument("--step-us", type=float, default=1000.0)
    ap.add_argument("--gap-us", type=float, default=1000.0)
    ap.add_argument("--file", default=None)
    known, rest = ap.parse_known_args()
    if known.file:
        cmds = [l.split() for l in open(known.file) if l.strip().startswith("./emu")]
        results = []
        for n, argv in enumerate(cmds, 1):
            results.append(run(argv, known.design, None, known.step_us, known.gap_us))
            print()
        print(f"emu_sim: {sum(results)} of {len(results)} ./emu runs passed")
        return 0 if all(results) and results else 1
    return 0 if run(rest, known.design, known.vcd, known.step_us, known.gap_us) else 1


if __name__ == "__main__":
    sys.exit(main())
