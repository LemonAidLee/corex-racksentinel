# Evidence behind the report (final submission materials, 2026-09-30)

Designs come from the teammate's submission folder
`Stage3_Submission_Materials/teammate_version-20260929T081943Z-1-001/teammate_version/`:

| Copy here | Original | What it is |
|---|---|---|
| `hdl_app.v` | `hdl(data_center_v).v` | Application export, `IMEM_Data_Center` (275 words); identical to `stage3_design-2026.09.29_ver2/design/rtl/top.v` |
| `hdl_testfw.v` | `hdl(data_center_v2).v` | The same export with the `IMEM_TESTFW` ROM (organizer firmware); nothing else differs |
| `tb_dc_teammate_final12.v` | `tb_dc_teammate.v` | Final 12-case application testbench (C13 removed) |
| `tb_official_final.v` | pasted by the user | Official GPIO/UART testbench (20 checks) |

## Platform evidence (ChipInventor), used for the figures

`Stage_3_v2_diagrams/New_Screenshots/`:
- `Result_Screenshots.pdf` p.3: official testbench, 20 checks, 0 failures, `$finish` at 1,062,040,000 ps → Fig 5a.
- `Waveform_Original.png`: waveform of that run → Fig 5b (rows 0–182, 325–445 and 493–517 kept; testbench parameter rows removed).
- `Result_Screenshots.pdf` p.7–18: C12 … C01, each case on its own; the checks add up to 124, 0 failures. Page 8 (C11) → Fig 8b.
- `digital.chipinventor.com_beta_v1_main.php (1).png`: canvas → Fig 3 (full) and Fig 4 (crop).
- `Waveform.png` is **not used**: it is the old V1 figure (19,238 cycles, 0.77 ms) and does not match the current testbench.

## Local reruns (Icarus Verilog 12.0, in `final/`)

| Run | Command | Result |
|---|---|---|
| Official | `iverilog -g2012 -o off.vvp ../tb_official_final.v ../hdl_testfw.v && vvp -n off.vvp` | 20 checks, 0 failures, 1,062,040,000 ps (same as the platform) |
| Application | `iverilog -g2012 -o app.vvp ../tb_dc_teammate_final12.v ../hdl_app.v && vvp -n app.vvp` | 12 cases, 124 checks, 0 failures; `app_final12.vcd` → Fig 8a |
| `./emu` lines | `grep -A1 "EMU RUN" app_final12.log` → `emu_runs12.txt` | C01–C12 identical to the earlier lines |
| Mutation | teammate's `build/mutants_final/*.log` (`mutate_final.sh`) | 4 of 4 killed: 5, 4, 2, 1 failing checks |
| CRC | teammate's `crc_verify.py` (also `../crc_vs_checksum.py`) | 0x29B1; 0 of 18,472 missed; XOR misses 80 of 10,700 |
| Timeout loop | `../tb_loop_cycles.v` on `hdl_app.v` | 20 cycles per poll |

## Official ROM (updated 2026-09-30)

`IMEM_TESTFW.v` (latest upload, workspace root) now matches the organizer's `firmware.txt`
word for word (21/21). The earlier version used `t0` in words 17-19; `sim/hdl_testfw.v` now
contains the corrected block (the rest of the design is unchanged), and the official testbench
still gives 20 checks, 0 failures, `$finish` at 1,062,040,000 ps. The submission copy
`hdl(data_center_v2).v` still carries the old words 17-19 until it is re-exported.
