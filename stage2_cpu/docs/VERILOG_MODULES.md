# VERILOG_MODULES.md — Source Index

> **This file used to carry hand-written source for glue blocks (`ir_splitter`,
> `PC_Register`, `IR_Register`, `PC_Plus4_Adder`, `PC_Src_Mux`, `WB_Mux`,
> `alu_srca_mux`, `alu_srcb_mux`, `addr_mux`, `Imm_Sel_Decoder`, an inverter and
> constant blocks). None of those modules exist in the exported design.** Their
> functions are absorbed into `PC_Unit` and `Datapath_Mux`. That source has been removed
> rather than kept as a misleading reference.
>
> The authoritative Verilog is the export itself. This file is now an index into it.

## Where the source lives

> **9 Sep 2026 update:** the export is now `design-2026.09.09/`, and its memory modules
> are `IMEM_MOCK.v`/`DMEM_MOCK.v`, not `IMEM_FIRMWARE.v`/`DMEM.v` — a disclosed
> OpenLane-only substitution (PLATFORM_NOTES.md). Every other module below is
> re-verified byte-identical; only line numbers after `Address_Decoder` shift, because
> the mocks are much shorter than the files they replace and module order in `top.v`
> also changed slightly.

**Directory Structure:**
- `design-2026.09.09/design/`
  - `hdl.v` — flattened whole design (all 14 modules in one file)
  - `simulate.v` — byte-identical to hdl.v
  - `rtl/`
    - `top.v` — byte-identical to hdl.v; `module top` at line 837
    - `alu.v`
    - `CRC16_Unit.v`
    - `MULT_Unit.v`
    - `LSU.v`
    - `BRANCH_COMPARATOR.v`
    - `IMM_GENERATOR.v`
    - `Register_File.v`
    - `Address_Decoder.v`
    - `Control_Unit.v`
    - `PC_Unit.v`
    - `Datapath_Mux.v`
    - `IMEM_MOCK.v` — was IMEM_FIRMWARE.v (mock, 3 instructions, disclosed)
    - `DMEM_MOCK.v` — was DMEM.v (mock, disclosed)
  - `config.json` — OpenLane configuration (fixed — run RUN_2026.09.09_01.14.39 succeeded; see PLATFORM_NOTES.md)

`hdl.v`, `simulate.v` and `rtl/top.v` are the same file, each containing all 13 modules
followed by `top`.

## Module index — line numbers within `hdl.v` / `rtl/top.v` (design-2026.09.09)

| Module | Lines | Size | Notes |
|---|---|---|---|
| `alu` | 4–43 | 1.4 kB | 11 ops incl. `PASS_B` |
| `CRC16_Unit` | 50–95 | 1.6 kB | CRC-16-CCITT, poly `0x1021` |
| `MULT_Unit` | 100–139 | 1.5 kB | Zmmul via sign-corrected unsigned product |
| `LSU` | 145–236 | 4.5 kB | core-perspective pin names |
| `BRANCH_COMPARATOR` | 241–269 | 1.0 kB | |
| `IMM_GENERATOR` | 274–304 | 1.4 kB | opcode-decoded, **no** `imm_sel` port |
| `Register_File` | 311–352 | 1.8 kB | instance `blk2832_43` |
| `Address_Decoder` | 357–404 | 1.5 kB | |
| `Control_Unit` | 410–660 | 9.6 kB | largest module; 4-state FSM |
| `PC_Unit` | 665–698 | 0.9 kB | |
| `Datapath_Mux` | 703–771 | 2.2 kB | IR + field extraction + 4 muxes |
| `IMEM_MOCK` | 776–796 | 0.85 kB | **mock** — 3 instructions, default NOP; was `IMEM_FIRMWARE` (1024 words, 259 initialised) |
| `DMEM_MOCK` | 801–829 | 0.90 kB | **mock** — `DEPTH_W=4` (4 words / 16 B; header comment wrongly says "2048 words = 8 kB", see CLAUDE.md Golden Rule 12); was `DMEM` (2048 words) |
| `top` | 837–1049 | — | 13 instances, 44 nets |

Full port lists and behaviour for every module are in **ARCHITECTURE.md**.
The complete pin-to-pin netlist of `top` is in **WIRING.md**.

## Reading the firmware image out of the RTL

`IMEM_FIRMWARE.v` (the full-firmware export, not the `design-2026.09.09` OpenLane mock)
holds the program as literal assignments. To dump it as address/word pairs, point this at
whichever export still carries `IMEM_FIRMWARE.v`:

```python
import re
src = open('design-2026.09.08/design/rtl/IMEM_FIRMWARE.v').read()
rom = {int(m.group(1)): int(m.group(2).replace('_', ''), 16)
       for m in re.finditer(r"r_Rom\[(\d+)\]\s*=\s*32'h([0-9A-Fa-f_]+)", src)}
for i in sorted(rom):
    print('0x{:08X}  0x{:08X}'.format(0x00400000 + i*4, rom[i]))
```

259 entries come back, indices 0–258. See FIRMWARE_AND_SIM.md for the PASS/FAIL epilogue
and the data constants at the tail.

## Things to check before pasting any module back into ChipInventor

- **Port names are load-bearing.** The canvas wires by pin name; renaming a port silently
  breaks a connection. In particular the `LSU` pin names read backwards
  (`core_data_o` is an *input*) — see ARCHITECTURE.md.
- **Reset polarity is active-high** throughout (`i_Rst` / `i_rst`). Do not introduce an
  active-low port or an inverter.
- **`Datapath_Mux` and `PC_Unit` are the only blocks that bit-slice**, and they do it
  internally on their own registers, which the platform allows.
- The converter (`convertion/logs/converter_260908_155112.log`, version 3.15) regenerates
  `hdl.v` from `diagram.json`; edits made directly to `hdl.v` will be overwritten on the
  next export.
