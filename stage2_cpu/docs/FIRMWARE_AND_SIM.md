# FIRMWARE_AND_SIM.md — Simulation, Testbench & Firmware Validation

> This file describes the **full-firmware functional simulation** (Stage 6, PASS) — the
> firmware image below was read out of `IMEM_FIRMWARE.v` in the functional-verification
> export; the top-level port list is confirmed unchanged in `design-2026.09.09/design/rtl/top.v`.
>
> **`design-2026.09.09/` — the current OpenLane-run export — does not ship
> `IMEM_FIRMWARE.v`/`DMEM.v`.** It ships `IMEM_MOCK.v`/`DMEM_MOCK.v` (a disclosed
> 3-instruction placeholder used only to keep the OpenLane physical-implementation run
> small — see PLATFORM_NOTES.md and CLAUDE.md Golden Rule 3). Everything in this file —
> the PASS/FAIL convention, the CRC self-check, the register/signal paths — describes the
> real-firmware run and remains the correct reference for the firmware demo (report
> section 6) and the simulation video; it is **not** what the OpenLane GDSII was built
> from.

## Firmware source

Repo: `github.com/championchip-experience-community/CCX_Malaysia_Edition_Firmware_Stage_2`
Embedded in `IMEM_FIRMWARE.v` as 259 `r_Rom[n]` assignments, indices 0–258, mapped to
byte addresses `0x00400000`–`0x00400408`. Start PC `0x00400000` matches
`PC_Unit.c_RESET_VECTOR`.

The ROM is 1024 words deep; every unwritten location is `32'h0000_0013` (NOP).

**259 words = 254 instruction words + 5 data words.** The tail is not code:

| Address | Index | Word | Meaning |
|---|---|---|---|
| `0x004003E8` | 250 | `0x00000213` | `addi x4, x0, 0` → x4 = 0 (**PASS**) |
| `0x004003EC` | 251 | `0x0000006F` | `jal x0, 0` → PASS self-loop |
| `0x004003F0` | 252 | `0xFFF00213` | `addi x4, x0, -1` → x4 = 0xFFFFFFFF (**FAIL**) |
| `0x004003F4` | 253 | `0x0000006F` | `jal x0, 0` → FAIL self-loop |
| `0x004003F8` | 254 | `0x12345678` | data constant |
| `0x004003FC` | 255 | `0x90ABCDEF` | data constant |
| `0x00400400` | 256 | `0x11111111` | data constant |
| `0x00400404` | 257 | `0x22222222` | data constant |
| `0x00400408` | 258 | `0x33333333` | data constant |

Those five constants live **inside the IMEM window**, which is exactly why the load path
must be able to read from IMEM (see WIRING.md, "The read path").

## PASS / FAIL convention

Register **x4** holds the verdict: `0x00000000` = PASS, `0xFFFFFFFF` = FAIL.

Fastest read — watch where `o_PC` settles into its self-loop:
- **`0x004003EC`** → **PASS**
- **`0x004003F4`** → **FAIL**

`o_PC` is a top-level output, so no hierarchy path is needed to read it.

**LAST CONFIRMED RESULT: PASS** — `o_PC = 0x004003EC`, x4 = `0x00000000`.

## The firmware's CRC self-check

The check that historically exposed the memory-read bug sits at index 217–221:

| Address | Word | Instruction |
|---|---|---|
| `0x00400364` | `0x80A32533` | `crcw x10, x6, x10` (funct7 = `1000000`, funct3 = 2) |
| `0x00400368` | `0x80A3A533` | `crcw x10, x7, x10` |
| `0x0040036C` | `0x000028B7` | `lui x17, 0x2` → x17 = `0x00002000` |
| `0x00400370` | `0xE8288893` | `addi x17, x17, -382` → **x17 = `0x00001E82`** |
| `0x00400374` | `0x07151E63` | `bne x10, x17, …` → taken means FAIL |

**The expected CRC reference value is `0x1E82`**, derived from the firmware itself
(`0x2000 − 382 = 0x1E82`). This is also what CRC-16/CCITT-FALSE over the byte sequence
`12 34 56 78 90 AB CD EF` from seed `0xFFFF` evaluates to, and what report section 4.6
states. Earlier revisions of these notes recorded `0x1E88` — that was a transcription
error and has been corrected throughout.

The two CRCW operands come from loads of `0x004003F8` (`0x12345678`) and `0x004003FC`
(`0x90ABCDEF`).

## Testbench

⚠️ The top-level interface is **`clk_i` + `rst_i` (active HIGH)**, plus three observation
outputs. There is no `rst_n_i`. A testbench written against the old active-low port list
will hold the CPU in reset forever.

```verilog
`timescale 1ns / 1ps

module testbench();

    reg clk_i = 0;
    reg rst_i = 1;                     // ACTIVE HIGH: start asserted

    wire [31:0] o_PC;
    wire [1:0]  o_State;
    wire        o_RD_We;

    top dut (
        .clk_i   (clk_i),
        .rst_i   (rst_i),
        .o_PC    (o_PC),
        .o_State (o_State),
        .o_RD_We (o_RD_We)
    );

    always #5 clk_i = ~clk_i;          // 10 ns period

    initial begin
        rst_i = 1;
        #12;
        rst_i = 0;                     // release reset
    end

    initial begin
        $dumpfile("testbench.vcd");
        $dumpvars(0, testbench);
    end

    initial begin
        #50000 $finish;                // ~10.4 us needed; 50 us is comfortable
    end

endmodule
```

The design export ships no testbench (`design/testbench/` is empty), so this is the
reference bench to use.

**Run length:** 254 instructions × 4 cycles × 10 ns ≈ **10.2 µs**. `#50000` is ample.
For short directed tests `#400`–`#5000` is enough.

## Signals to watch

**Core sanity (all top-level outputs — no hierarchy needed):**
`o_PC`, `o_State` (cycles 0→1→2→3), `o_RD_We`.

**Inside the design** (hierarchy `testbench.dut.<instance>`):

| Purpose | Path |
|---|---|
| Instruction register | `dut.blk3326_45.o_IR` |
| Write-back value / destination | `dut.blk3326_45.o_WB_Data`, `dut.blk3326_45.o_RD_Addr` |
| Write-back source select | `dut.blk3000_35.o_WB_Sel` (0=ALU, 1=LSU, 2=MUL, 3=CRC, 4=PC+4) |
| Branch decision | `dut.blk2820_37.o_Branch_Taken`, `dut.blk3000_35.o_PC_Src` |
| Store formatting | `dut.blk2775_44.mem_data_o`, `dut.blk2775_44.byte_write_i` |
| Load result | `dut.blk2775_44.core_data_i` |
| Raw read word | `dut.blk2847_46.o_core_data` |
| Multiplier / CRC | `dut.blk2761_41.o_Result`, `dut.blk2756_42.o_Result` |

## Reading a specific register (x4, x10, x17, …)

The register array is `registers[0:31]` inside **`blk2832_43`** (the `Register_File`
instance). Full path: `testbench.dut.blk2832_43.registers[N]`.

> The instance is `blk2832_43`. Earlier notes said `blk3650_34`; that instance name does
> not exist in this design.

If the waveform viewer will not expose the array, use the write-watch method instead:
find the last rising `clk_i` edge where `o_RD_We == 1` and `blk3326_45.o_RD_Addr == N`;
the value on `blk3326_45.o_WB_Data` at that edge is what register N received.

Register numbers in hex: x4 = `4`, x6 = `6`, x7 = `7`, x10 = `a`, x17 = `11`.

Optional force-dump of the array (produces harmless "escaped identifier" warnings):

```verilog
integer k;
initial for (k = 0; k < 32; k = k + 1)
    $dumpvars(0, testbench.dut.blk2832_43.registers[k]);
```

## Timing notes

- **IMEM read is combinational** (`assign o_Data = r_Rom[w_Index]`); `i_Oe` is wired but
  unused inside the module, so the instruction is available in the same cycle.
- **DMEM read is synchronous** — `o_Data` is registered on posedge when `i_Oe` is high,
  giving loads one cycle of latency. The Control Unit therefore keeps `o_Mem_Oe` and
  `o_Addr_Src` asserted through *both* EXECUTE and WRITEBACK for `OP_LOAD`.
- Registers latch on the **rising** `clk_i` edge only. Between edges `o_WB_Data` may
  flicker as the muxes settle across FSM states; only the rising-edge value is stored.
- The PC advances once per instruction, in WRITEBACK (`o_PC_Write` is asserted for every
  opcode).

## Common iverilog errors and fixes

- **Port mismatch on `top`** — `rst_n_i` is not a port. Use `rst_i`, and drive it
  **high** to reset.
- `Sized numeric constant must have a size greater than zero` → a Constant Value block on
  the canvas has zero width; set "Value in Verilog" to an explicitly sized literal such
  as `32'd0`.
- `port expects 32 bits, got 1` → a wire landed on the wrong (adjacent) pin; check the
  block's pin order on the canvas.
- Warnings about escaped identifiers when dumping `registers[k]` are harmless.
