# PLATFORM_NOTES.md — ChipInventor, OpenLane & Remaining Work

> Updated against the export `design-2026.09.09/` (9 Sep 2026, converter 3.15) and the
> completed run `OPENLANE_TEST-20260909-011438-openlanesky130-2026.09.09/`. Supersedes
> the `design-2026.09.08/` version of this file below the "OpenLane flow" heading — the
> ChipInventor platform notes (blocks, canvas, export layout) are unchanged and still
> apply.

## ChipInventor platform quirks

- Cloud EDA tool. Build by placing custom blocks on a canvas and wiring pins.
- **Custom blocks** are created from pasted Verilog. Accepts both plain Verilog (`wire`/`reg`) and SystemVerilog (`logic`) styles.
- **Cannot bit-slice a wire on the canvas.** In the current design this never bites, because field extraction happens *inside* `Datapath_Mux` (`r_IR[19:15]` etc.) rather than on the canvas. No splitter block is used.
- **Block instances** get auto-generated names like `blk3000_35`. The full list for this design is in ARCHITECTURE.md; the ones you will actually type are `blk2832_43` (Register_File) and `blk3326_45` (Datapath_Mux).
- **Constant Value block:** three fields (Enter Value, Select Format, Value in Verilog). Set "Value in Verilog" with an explicit width like `32'd0`. Zero width → error. *(None are used in the current design.)*
- **Canvas contents:** `convertion/diagram.json` holds the drawflow graph — 18 nodes: 13 module instances, 2 input ports (`clk_i`, `rst_i`), 3 output ports (`o_PC`, `o_State`, `o_RD_We`).
- **Export layout** (`design/`):
  - `hdl.v` — flattened whole design. **Byte-identical to `rtl/top.v` and `simulate.v`** in this export.
  - `rtl/*.v` — the 13 per-module sources plus `top`.
  - `config.json` — OpenLane configuration.
  - `logs/` — one `synthesis-output-*.log` per OpenLane run.
  - `convertion/` — `diagram.json` and the converter log.
  - `testbench/` — **empty in this export.** Use the reference bench in FIRMWARE_AND_SIM.md.
  - `rtl/IMEM_MOCK.v`, `rtl/DMEM_MOCK.v` — **this export's memories are mocks**, not
    `IMEM_FIRMWARE.v`/`DMEM.v`. Same ports/wiring, disclosed substitution — see
    CLAUDE.md Golden Rule 3 and the "IMEM / synthesis size question" section below.
  - `font.hex`, `fpga_exec.sh` — platform boilerplate, unrelated to this CPU.
- Top module is `top`, with ports `clk_i`, `rst_i` (**active high**), `o_PC[31:0]`, `o_State[1:0]`, `o_RD_We`.

## OpenLane flow

Full RTL-to-GDSII: Synthesis → STA → Floorplan → IO Placement → Tap/Decap → PDN →
Global Placement → Resizer → Detailed Placement → STA → CTS → STA → Resizer →
**Routing** → GDSII.

- PDK sky130A (`sky130_fd_sc_hd`), OpenLane v1.1.1.
- The run stages in a folder shown as `designs/spm/` in the logs — that is ChipInventor's staging name, **not** a different design. `DESIGN_NAME` in `config.json` is authoritative.

### Run history — seven runs, #7 SUCCEEDED

`design-2026.09.08/design/logs/` contains the six failed runs, dated 2 Sep to 4 Sep 2026
(all die at STEP 14, global routing, no GDSII). Run #7, dated 9 Sep 2026, used the fixed
`design-2026.09.09/design/config.json` and **completed the full RTL-to-GDSII flow.**

| Log / run | Run timestamp | Linter warnings | Result |
|---|---|---|---|
| `synthesis-output-dda2be47…` | `RUN_2026.09.02_05.37.40` | 451 | ❌ failed (global routing) |
| `synthesis-output-96f48a31…` | `RUN_2026.09.03_11.52.16` | 459 | ❌ failed (global routing) |
| `synthesis-output-118f28f6…` | `RUN_2026.09.04_06.52.29` | 459 | ❌ failed (global routing) |
| `synthesis-output-9237d676…` | `RUN_2026.09.04_07.00.42` | 459 | ❌ failed (global routing) |
| `synthesis-output-c8e795f6…` | `RUN_2026.09.04_07.05.37` | 459 | ❌ failed (global routing) |
| `synthesis-output-4b56dd5d…` | `RUN_2026.09.04_07.11.17` | 451 | ❌ failed (global routing) |
| **`RUN_2026.09.09_01.14.39`** | **9 Sep 2026, 01:14** | **449** | ✅ **`[SUCCESS]: Flow complete.`** |

The first six all report `0 errors found by linter`, floorplan `23.46 × 35.36`, then die
identically in Global Routing (`Total wirelength: 0 um`, `Found 0 clock nets`,
`[ERROR RSZ-0005]`), followed by a secondary `IndexError` in `generate_reports.py`.

### Run #7 results (`RUN_2026.09.09_01.14.39`) — full metrics

Source: `OPENLANE_TEST-20260909-011438-openlanesky130-2026.09.09/builds/.../reports/`.

| Metric | Value |
|---|---|
| Flow status | `flow completed` — total runtime 1h49m19s |
| Floorplan | width 638.94 µm × height 625.6 µm (core); die fixed at 650 × 650 µm |
| Die area | **0.4225 mm²** (650 × 650 µm, `FP_SIZING: absolute`) |
| Core area | 399,720.9 µm² (5.52,10.88 → 644.46,636.48) |
| Final utilization | **45.44%** (`PL_TARGET_DENSITY` target 0.45) |
| Cell count | 12,795 synthesized cells → 65,877 placed cells (incl. 15,594 fill, 11,495 diode, 5,684 welltap, 18,741 decap) |
| Wire length / vias | 697,884 (routing units) / 135,815 vias |
| Routing layer usage | met2 39.7%, met3 40.7%, met4 4.4%, met5 7.4% (li1/met1 0%) |
| Magic DRC violations | **0** |
| KLayout DRC violations | **0** (KLayout GDS vs. Magic GDS: no XOR differences) |
| LVS | **clean** — 14,367 / 14,367 nets match, 0 errors |
| Antenna violations | 3 pin, 3 net (flagged by the antenna rule checker; run still completed — not a blocking DRC/LVS failure) |
| Timing (typical corner) | WNS = 0.0 ns, TNS = 0.0 ns — **no setup or hold violations**; a max-fanout warning was issued (non-blocking) |
| Critical path | 11.68 ns against a 40.0 ns (25 MHz) clock period — large positive margin |
| Power, typical corner | internal 0.0028 µW, switching 0.00284 µW, leakage 9.98e-08 µW (also reported at slowest/fastest process corners in `metrics.csv`) |
| STD cell library | `sky130_fd_sc_hd`, synthesis strategy `AREA 0` |

GDSII: `results/final/gds/top.gds` (48 MB). Also produced: `results/final/lef/top.lef`,
`results/final/lib/top.lib`, `results/final/verilog/gl/top.v` + `top.nl.v` (gate-level
netlist), `results/final/spef/top.spef`, `results/signoff/top.gds` /
`top.klayout.gds` / `top.mag`. **No rendered layout screenshot was auto-generated by this
run** — for the report's layout image, render one from `results/signoff/top.gds` (or
`top.mag`) via KLayout/Magic.

### config.json — before (broken) vs. after (working)

The six failed runs used this `design-2026.09.08/design/config.json`:

```json
{
    "DESIGN_NAME": "top",
    "VERILOG_FILES": "dir::src/*.v",
    "CLOCK_TREE_SYNTH": false,
    "CLOCK_PORT": null,
    "PL_RANDOM_GLB_PLACEMENT": true,
    "FP_SIZING": "absolute",
    "DIE_AREA": "0 0 34.5 57.12",
    "PL_TARGET_DENSITY": 0.75,
    "FP_PDN_AUTO_ADJUST": false,
    "FP_PDN_VPITCH": 25,
    "FP_PDN_HPITCH": 25,
    "FP_PDN_VOFFSET": 5,
    "FP_PDN_HOFFSET": 5,
    "DIODE_INSERTION_STRATEGY": 3,
    "TEST_POTENTIALLY_MALICIOUS_VARIABLE": "{}{}{}{}}}}{{{\"\"\"''''",
    "TEST_EXTERNAL_GLOB": "dir::../custom_design/src/*"
}
```

Root cause: **no clock defined** (`CLOCK_PORT: null`, `CLOCK_TREE_SYNTH: false`) so CTS
built nothing and the router routed `0 nets`; and the die was fixed at a too-small
34.5 × 57.12 µm.

**`design-2026.09.09/design/config.json` — the config that actually worked:**

```json
{
    "DESIGN_NAME": "top",
    "VERILOG_FILES": "dir::src/*.v",
    "CLOCK_PORT": "clk_i",
    "CLOCK_PERIOD": 40.0,
    "PL_RANDOM_GLB_PLACEMENT": 0,
    "PL_TARGET_DENSITY": 0.45,
    "FP_SIZING": "absolute",
    "DIE_AREA": "0 0 650 650",
    "FP_PDN_AUTO_ADJUST": true,
    "RUN_HEURISTIC_DIODE_INSERTION": 1,
    "GRT_REPAIR_ANTENNAS": 1,
    "GRT_ADJUSTMENT": 0.1,
    "ROUTING_OPT_ITERS": 64,
    "DIODE_ON_PORTS": "none",
    "TEST_POTENTIALLY_MALICIOUS_VARIABLE": "{}{}{}{}}}}{{{\"\"\"''''",
    "TEST_EXTERNAL_GLOB": "dir::../custom_design/src/*"
}
```

**What actually changed, and how it differs from the fix previously drafted in this
file** (that draft recommended `FP_SIZING: relative`, `CLOCK_PERIOD: 20`,
`PL_TARGET_DENSITY: 0.55`, `DIODE_INSERTION_STRATEGY: 3` — none of which is what shipped):

- `CLOCK_PORT: "clk_i"` — the actual fix; defines the clock so CTS and the router have
  something to build. (`CLOCK_TREE_SYNTH` is no longer set explicitly — omitted rather
  than `true`, and CTS ran anyway; it's implied once a clock port is given.)
- `CLOCK_PERIOD: 40.0` (25 MHz), not 20 ns as drafted — a more conservative period, and
  with an 11.68 ns critical path there was room to go faster if a smaller period is
  wanted later.
- `FP_SIZING: "absolute"` with a hand-picked `DIE_AREA: "0 0 650 650"` (650 × 650 µm),
  **not** `"relative"` auto-sizing as drafted. The bigger fixed die, not auto-sizing, is
  what fixed the too-small-die half of the problem.
- `PL_TARGET_DENSITY: 0.45`, not 0.55 as drafted — achieved 45.44% final utilization.
- Antenna handling uses the modern `GRT_REPAIR_ANTENNAS` / `DIODE_ON_PORTS` /
  `RUN_HEURISTIC_DIODE_INSERTION` trio instead of the deprecated
  `DIODE_INSERTION_STRATEGY` that was drafted — matches what OpenLane's own deprecation
  warning recommended. Result: 3 pin / 3 net antenna violations remained, not zero, but
  the run still succeeded.
- **The junk `TEST_POTENTIALLY_MALICIOUS_VARIABLE` / `TEST_EXTERNAL_GLOB` keys are still
  present**, unremoved. OpenLane silently ignores unrecognized config keys, so they did
  not block the run — but they should still be dropped before final submission for
  cleanliness.

### The IMEM / synthesis size question — RESOLVED

**A mock IMEM was introduced for this run.** `design-2026.09.09/design/rtl/IMEM_MOCK.v`
replaces `IMEM_FIRMWARE.v`; `DMEM_MOCK.v` replaces `DMEM.v`. Same ports, same wiring, per
the disclosure requirement:

```verilog
// Program: x5=10; x6=5; x7=x5+x6 -> x7=15
32'h0040_0000: o_Data = 32'h00A0_0293; // addi x5, x0, 10
32'h0040_0004: o_Data = 32'h0050_0313; // addi x6, x0, 5
32'h0040_0008: o_Data = 32'h0062_83B3; // add  x7, x5, x6
default:       o_Data = 32'h0000_0013; // NOP
```

This is **disclosed** here and must be disclosed in report section 4.8/4.12: the OpenLane
GDSII was built from a 3-instruction placeholder program, not the 259-word official
firmware. The full-firmware functional PASS result (Stage 6, `o_PC = 0x004003EC`, x4 = 0)
came from a separate simulation run against the real `IMEM_FIRMWARE.v`/`DMEM.v` — the two
results are complementary, not the same run, and both are legitimate: OpenLane proves the
design is physically manufacturable; the firmware simulation proves it is functionally
correct. Don't conflate them in the report.

Also note (see CLAUDE.md Golden Rule 12): `DMEM_MOCK.v`'s comment claims "2048 words =
8 kB" but `DEPTH_W = 4` actually makes it a 4-word (16-byte) array. Harmless here since
the 3-instruction mock program never touches DMEM, but don't cite "8 kB DMEM" for this
particular build.

## Required OpenLane deliverables — status

- ✅ **GDSII** — `results/final/gds/top.gds` (also `results/signoff/top.gds`,
  `top.klayout.gds`, `top.mag`)
- ✅ **Gate-level netlist** — `results/final/verilog/gl/top.v`, `top.nl.v`
- ✅ **`config.json` actually used** — `design-2026.09.09/design/config.json` (reproduced
  above)
- ✅ **Area and density figures** — die 0.4225 mm², core 399,720.9 µm², 45.44%
  utilization (table above / `reports/metrics.csv`)
- ⬜ **Final layout image** — not auto-generated by this run; still needs to be rendered
  from `results/signoff/top.gds` (KLayout) or `top.mag` (Magic) for the report.

## Remaining work

1. ~~Apply the corrected `config.json` and re-run OpenLane until it completes.~~ **Done —
   run #7 succeeded.**
2. Render a layout screenshot from the signed-off GDS/MAG for the report (the one
   remaining deliverable gap).
3. **Report** (M5 sections): 4.12 Processor Integration, 5 OpenLane Results, 6 Firmware
   Demo — being rewritten against `design-2026.09.09/` and the run #7 results. Combine
   team sections into one PDF (≤20 pages, ≤10 MB) and insert the video URL.
4. **Video:** 45–60 s clip covering integration / verification / firmware / OpenLane /
   GDSII; raw clip to M4 (Law), who edits the combined 3–4 min team video (YouTube,
   public or unlisted, URL in the report).
5. **Team-level:** instruction coverage table (M4 owns), final submission package (RTL,
   GDSII, gate-level netlist, `config.json`, all code and testbenches, video URL). Before
   packaging, drop the leftover `TEST_*` junk keys from `config.json`.

## Submission checklist (from the guide)

- Report (PDF, ≤20 pages, ≤10 MB) covering: project overview, supported instructions (ISA coverage + encodings), datapath, modules & testbenches, OpenLane results (area/density + GDSII image), firmware demo (waveforms + logs).
- GDSII from OpenLane.
- Gate-level netlist (`results/final/verilog/gl`).
- The `config.json` used.
- All developed code including testbenches.
- YouTube video URL in the report.
- **Integrity:** RTL, testbenches, config and physical results must all correspond to the same processor.

## Team & deadlines

Group 31, team name **CoreX**, 5 members: Law Hui Tan, Chia Jing Xiang, Ooi Chin Ming,
Lee Wen Yi, Muhammad Ammar bin Lukman Hakim.
M1 = Control/FSM, M2 = Datapath (ALU/RegFile/ImmGen/BranchComp), M3 = LSU/Memory,
M4 = Multiplier/CRC + video editing, M5 = integration/verification/OpenLane.
Internal deadline 7 Sep 2026; official deadline 11 Sep 2026, 23:59.
