# RackSentinel: the team's application (data-centre rack guardian)

RackSentinel is the design selected for the final stage. `SPEC.md` describes its behaviour and
`DEMO.md` is the live-demo script. This is **v2** (2026-10-08); v1, as submitted for Stage 3,
is the git tag `rack-v1-verified`.

| File | What it is |
|---|---|
| `rack_sentinel.s` | Firmware source (RV32I + Zmmul + `crcb`), 547 instructions |
| `IMEM_DATA_CENTER.v` | ROM generated from it (`build.sh`); module `IMEM_DATA_CENTER`, the canvas block name |
| `hdl_rack.v` | **Paste into ChipInventor**: the 8-pin canvas design with this ROM |
| `tb_soc_rack.v` | Team testbench: 16 scenarios and 9 `./emu` runs, 524 checks |
| `tb_platform_rack.v` | **Paste into ChipInventor**: the 9 runs, one batch at a time (generated) |
| `emu_runs.txt`, `emu.sh` | The 9 verified `./emu` lines; `emu.sh --all` replays them in simulation |
| `release/` | Organizer Makefile build: `main.s`, `firmware.bin/.txt/.dmp/.elf` |
| `build.sh` | Rebuild the ROM and check it against the GNU toolchain (bit-identical) |
| `gen_platform_tb.py` | Regenerate `tb_platform_rack.v` after editing `tb_soc_rack.v` |
| `mutate.sh` | 23 planted firmware bugs; each must make `tb_soc_rack` fail |
| `imem_shim.v` | Local simulation only: maps `IMEM` (in `stage3_top.v`) to `IMEM_DATA_CENTER` |
| `demo/rack_demo.html` | **Demo page** (open in a browser, works offline): random and rehearsed test cases, the `./emu` command for each, every step explained, and a box that compares pasted FPGA output |
| `demo/verify_demo.py` | Replays every case the page can show on the RTL and stamps the page (see below) |
| `SPEC.md`, `DEMO.md` | Specification; live-demo script and pitch points |
| `report/`, `evidence/` | **Stage 3 submission (v1):** the 7-page report and the platform screenshots of that version |

## Commands (from `CoreX/`)

    ./run_all_tests.sh rack          # tb_rack_soc, tb_rack_canvas, tb_rack_platform
    apps/rack_sentinel/build.sh      # after editing rack_sentinel.s
    apps/rack_sentinel/emu.sh --all  # replay the 9 ./emu runs
    apps/rack_sentinel/emu.sh -d 0xF0 -t4 0xFE072C20 -r1 0xA5 -o 0x00
    apps/rack_sentinel/mutate.sh     # slow (~15 min)

## Demo page

`demo/rack_demo.html` holds a JavaScript model of the firmware. For a seed it builds a short
test case from one of ten scenarios (heating up, overheat and reset, cooling failure, leak,
overload, energy, memory fault of one or two bits, noisy link and bad input, threshold change),
prints the `./emu` line with the expected values in it, and explains each option and each reply.
Paste the FPGA's `./emu` output into the page and it marks each step as matching or not.

    python3 apps/rack_sentinel/demo/verify_demo.py           # all 1,000 seeds + R1-R9 on the RTL, then stamp (about 30 min)
    python3 apps/rack_sentinel/demo/verify_demo.py --seeds 40
    python3 apps/rack_sentinel/demo/verify_demo.py --check   # fast; also run by run_all_tests.sh

The page shows "pre-verified" only for seeds 1 to 1,000 and only while the hash of its model
equals the stamp that `verify_demo.py` wrote after a full pass. Editing the model block (or
the firmware) means running `verify_demo.py` again.

After changing the firmware:

    apps/rack_sentinel/build.sh
    python3 sim/make_paste_hdl.py ../hdl_stage3.v apps/rack_sentinel rack
    ./run_all_tests.sh rack

Then copy the new `./emu` lines from `sim/build/tb_rack_soc/run.log` into `emu_runs.txt` (the
runner fails if they differ), rebuild `release/` with the organizer's Makefile, and copy the
ROM module into `chipinventor/canvas_blocks/IMEM_DATA_CENTER.v`.

## Putting v2 on ChipInventor

1. **Canvas:** paste `CoreX/chipinventor/canvas_blocks/IMEM_DATA_CENTER.v` into the IMEM block
   (named `IMEM_DATA_CENTER`); the UART parameter stays 0. Export and save over
   `hdl_stage3.v`.
2. **Platform test:** paste `hdl_rack.v` and `tb_platform_rack.v`; set `FIRST_RUN = LAST_RUN = k`
   for k = 1 to 9. Each run takes 2.7 ms or less and ends with `tb_platform_rack PASSED`.
