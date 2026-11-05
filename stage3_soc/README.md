# Stage 3 · The SoC and RackSentinel v1

The RVBL-2 CPU from Stage 2 with memory-mapped GPIO and UART, validated with the organisers' test firmware, then reprogrammed as RackSentinel v1 (6-byte SAMPLE packet, latched power-off). Simulation only; the FPGA run belongs to Stage 4. Explained in [../docs/06-soc-and-memory-map.md](../docs/06-soc-and-memory-map.md), [../docs/11-verification.md](../docs/11-verification.md) and [../docs/14-project-journey.md](../docs/14-project-journey.md).

| Path | Contents |
|---|---|
| `submission/` | **The package as submitted**, unchanged, with its own git history. Start with `README_RackSentinel_FINAL.md` |
| `report/` | The Stage 3 report: LaTeX sources, figures, `Stage_3_Report_v2.pdf`, and `sim/` with the reruns behind its figures |
| `platform_screenshots/` | ChipInventor canvas screenshots and `New_Screenshots/Result_Screenshots.pdf` (platform logs per case) |
| `organiser_reference/` | Organiser repository: `RVBL-Emulator/src/emu.c`, `RVBL-GPIO-UART-Test-Firmware/`, `RVBL-Firmware-Builder/` |
| `Stage3_Submission_Guide.pdf` | Organiser rules and register specifications |

Key results: official firmware 20 checks, 0 failures; v1 regression 12 cases, 124 checks, 0 failures; mutation 4/4; CRC 18,472 patterns, 0 missed; firmware-to-ROM 275/275.

> In `organiser_reference/RVBL-Firmware-Builder/`, `src/main.s` and `build/` hold a teammate's firmware, not the organisers' original example.
