# Stage 4 · RackSentinel v2 on the AWS FPGA

RackSentinel v2 (2026-10-08): 4-byte packets, water-leak input, thermal-runaway detection, power limit and energy metering, SECDED ECC on every safety setting, and a trip record. Built on the AWS FPGA on 2026-10-10; all nine rehearsed `./emu` runs pass on the hardware. Explained in [../docs/01-racksentinel.md](../docs/01-racksentinel.md), [../docs/02-rules-and-protocol.md](../docs/02-rules-and-protocol.md) and [../docs/03-fpga-and-demo.md](../docs/03-fpga-and-demo.md).

| File | Contents |
|---|---|
| `riscv.sv` | The whole SoC with the v2 ROM (547 instructions) and the AWS wrappers (clock ÷ 8 to 31.25 MHz, reset synchroniser). It instantiates the organisers' AWS top level, which is not redistributed here. Generated; do not edit |
| `SPEC.md` | The v2 specification: the source of truth for behaviour |
| `rack_demo.html` | Offline demo page: R1 to R9, 1,000 pre-verified cases, paste-and-compare with FPGA output |
| `evidence/` | Vivado log (0 errors, WNS +0.711 ns), AFI `available`, load and reset, `fpga_emu_R1.png` to `R9.png` |
| `README_CoreX.md` | JX's guide to the CoreX repository, where the v2 source, testbenches and scripts live (not in this folder) |

Image IDs: AFI `afi-0d0eb57f78ad69e3b`, AGFI `agfi-0a4f37f7744a84a88`.
