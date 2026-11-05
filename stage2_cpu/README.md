# Stage 2 · The RVBL-2 CPU

The RISC-V processor every later stage runs on: RV32I (37) + Zmmul (4) + Xicrc custom CRC (3) = 44 instructions, a four-state multicycle design built on the ChipInventor canvas. Explained in [../docs/05-the-cpu.md](../docs/05-the-cpu.md).

| Folder | Contents |
|---|---|
| `design/` | ChipInventor export: `rtl/` (13 modules + `top.v`), `hdl.v` (flattened, identical to `rtl/top.v`), `config.json` (OpenLane configuration), `logs/` (synthesis log of the successful run), `convertion/` (canvas graph) |
| `docs/` | Original Stage 2 engineering notes: `ARCHITECTURE.md`, `WIRING.md`, `VERILOG_MODULES.md`, `STAGES_AND_BUGS.md`, `FIRMWARE_AND_SIM.md`, `PLATFORM_NOTES.md`, `EXPLAIN_LIKE_IM_FIVE.md`, `visual-guide.html` |
| `openlane/` | OpenLane run 7 (9 Sep 2026), slimmed from 2 GB to about 83 MB: `config.tcl`, `reports/` (metrics, DRC, LVS, antenna, timing summaries), `results/final/` (GDS, gate-level netlist, DEF, LEF, LIB, SDC), logs |

Key results: firmware self-test PASS (PC settles at `0x004003EC`); OpenLane completed on sky130, die 0.4225 mm², DRC 0, LVS clean, WNS 0.0 ns at 25 MHz.

> The `design/rtl/` memories are the mock ROM and RAM used for the OpenLane run. The notes in `docs/` refer to export folders by their original names (`design-2026.09.09/` and so on); in this workspace that export is `design/`.
