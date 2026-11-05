# RackSentinel — Final Test Cases (C01–C12)

These are the final test cases in **`testbench/tb_data_center_application.v`** for the RackSentinel application firmware **`firmware/firmware_application/main.s`**
(ROM `IMEM_Data_Center`, design `rtl/hdl/hdl_application.v`). The final suite contains cases **C01–C12** and reflects the latched-EPO reset behaviour used by the submitted design. The testbench prints its summary under the name `tb_dc_teammate`.

Final regression result: **12 cases, 124 checks, 0 failures**. Each case starts from a reset,
returns at most 8 reply bytes, and runs in 2.6 ms of simulated time or less.

## How to read the tables

| Item | Meaning |
|---|---|
| Sample `(V, I, T)` | One 6-byte packet `[0x5A][V][I][T][CRC_LO][CRC_HI]`: V in volts; I raw × 0.2 A (127 = 25.4 A, 128 = 25.6 A, 160 = 32.0 A, 161 = 32.2 A); T raw × 0.5 °C (53 = 26.5, 54 = 27.0, 64 = 32.0, 65 = 32.5) |
| Reply | `A5` accepted · `5A` bad CRC · `3C` invalid / unknown command (including the removed `0x47` power factor and `0x51` energy) |
| Pins (`-o`) | P7..P4: `10` fan boost (Warm) · `20` fans max (Critical temp) · `40` current warning · `80` EPO. Combinations add, e.g. `A0` = fans max + EPO, `C0` = current warning + EPO, `E0` = all three |
| P0 (`-i`) | `-i 0x01` presses the operator reset, `-i 0x00` releases it |
| Thresholds | Warm ≥ 27.0 °C · temperature Critical > 32.0 °C · current Warning ≥ 25.6 A · current trip > 32.0 A |
| EPO rule | Trips on Critical temperature or a current trip, then **latches**. A new P0 press clears it only when the temperature is Normal (< 27 °C) and the current is < 25.6 A |

## Case summary

| Case | Purpose | Pass criteria | Change vs original |
|---|---|---|---|
| C01 | Normal temperature and current | All outputs off; STATUS Normal, 0 trips | — |
| C02 | Warm boundaries | 27.0 °C and exactly 32.0 °C are Warm (fan boost), no EPO | — |
| C03 | Temperature Critical | 32.5 °C: fans max + EPO on the first reading; 1 trip | — |
| C04 | Current boundaries | 25.4 A Normal; 25.6 A and exactly 32.0 A are Warning, no EPO | — |
| C05 | Current Critical | 32.2 A: warning + EPO on the first reading; 1 trip | — |
| C06 | Either fault is enough | EPO stays on with both, only current, or only temperature Critical | — |
| C07 | Both must become Normal | EPO stays on in the warning bands and **stays latched** when safe; P0 clears it | **changed:** was auto-clear |
| C08 | Warm temperature blocks recovery | EPO stays on at 32.0 °C; latched at 26.5 °C; P0 clears it | **changed:** was auto-clear |
| C09 | Warning current blocks recovery | EPO stays on at 25.6 A and **P0 is refused**; latched at 25.4 A; P0 clears it | **changed:** was auto-clear, plus the refused press |
| C10 | Invalid packets | Invalid temperature (raw 0) → `3C`, bad CRC → `5A`; EPO and pins unchanged | — |
| C11 | P0 reset rules | Reset refused while Critical and while Warm; accepted once safe | **new** |
| C12 | Held button | A button held down through a trip and recovery never clears the EPO; a new press does | **new** |


## Step by step

| Case | Step | Input / action | Reply | Pins | Meaning |
|---|---|---|---|---|---|
| C01 | 1 | Sample (230 V, 25.4 A, 26.5 °C) | A5 | `00` | Normal: all outputs off |
| | 2 | STATUS `0x50` | `40 35 7F 00` | — | flags `40` (temperature received), 26.5 °C, 25.4 A, 0 trips |
| C02 | 1 | Sample (230, 25.4 A, 27.0 °C) | A5 | `10` | Exactly 27.0 °C is Warm: fan boost |
| | 2 | Sample (230, 25.4 A, 32.0 °C) | A5 | `10` | Exactly 32.0 °C is still Warm, not Critical |
| | 3 | STATUS | `41 40 7F 00` | — | class Warm, 32.0 °C, no EPO, 0 trips |
| C03 | 1 | Sample (230, 25.4 A, 32.5 °C) | A5 | `A0` | Critical: fans max + EPO |
| | 2 | STATUS | `4B 41 7F 01` | — | Critical + EPO, 32.5 °C, 1 trip |
| C04 | 1 | Sample (230, 25.4 A, 25.0 °C) | A5 | `00` | 25.4 A Normal |
| | 2 | Sample (230, 25.6 A, 25.0 °C) | A5 | `40` | Exactly 25.6 A: current warning |
| | 3 | Sample (230, 32.0 A, 25.0 °C) | A5 | `40` | Exactly 32.0 A: warning, no EPO |
| C05 | 1 | Sample (230, 32.2 A, 25.0 °C) | A5 | `C0` | Current trip: warning + EPO |
| | 2 | STATUS | `4C 32 A1 01` | — | EPO + warning, 25.0 °C, 32.2 A, 1 trip |
| C06 | 1 | Sample (230, 32.2 A, 32.5 °C) | A5 | `E0` | Both Critical: fans max + warning + EPO |
| | 2 | Sample (230, 32.2 A, 25.0 °C) | A5 | `C0` | Only current Critical: EPO stays |
| | 3 | Sample (230, 25.4 A, 32.5 °C) | A5 | `A0` | Only temperature Critical: EPO stays |
| C07 | 1 | Sample (230, 32.2 A, 32.5 °C) | A5 | `E0` | Both Critical: EPO on |
| | 2 | Sample (230, 25.6 A, 27.0 °C) | A5 | `D0` | Warm + warning: EPO stays on |
| | 3 | Sample (230, 25.4 A, 26.5 °C) | A5 | `80` | Safe, but the EPO stays latched |
| | 4 | Press P0 (`-i 0x01`), release | — | `00` | Reset accepted: EPO off |
| C08 | 1 | Sample (230, 25.4 A, 32.5 °C) | A5 | `A0` | Critical: EPO on |
| | 2 | Sample (230, 25.4 A, 32.0 °C) | A5 | `90` | Warm: EPO stays on |
| | 3 | Sample (230, 25.4 A, 26.5 °C) | A5 | `80` | Normal, EPO latched |
| | 4 | Press P0, release | — | `00` | Reset accepted |
| C09 | 1 | Sample (230, 32.2 A, 25.0 °C) | A5 | `C0` | Current trip: EPO on |
| | 2 | Sample (230, 25.6 A, 25.0 °C) | A5 | `C0` | Warning current: EPO stays on |
| | 3 | Press P0, release | — | `C0` | **Refused**: current still at warning level |
| | 4 | Sample (230, 25.4 A, 25.0 °C) | A5 | `80` | Normal, EPO latched |
| | 5 | Press P0, release | — | `00` | Reset accepted |
| C10 | 1 | Sample (230, 25.4 A, 32.5 °C) | A5 | `A0` | Critical: EPO on |
| | 2 | Sample with temperature raw 0 | **3C** | `A0` | Invalid reading rejected; nothing changes |
| | 3 | Sample (230, 25.4 A, 26.5 °C) with a corrupted CRC | **5A** | `A0` | Bad CRC rejected; it cannot clear the EPO |
| C11 | 1 | Sample (230, 25.4 A, 32.5 °C) | A5 | `A0` | Critical: EPO on |
| | 2 | Press P0, release | — | `A0` | **Refused**: still Critical |
| | 3 | Sample (230, 25.4 A, 27.0 °C) | A5 | `90` | Warm, EPO latched |
| | 4 | Press P0, release | — | `90` | **Refused**: still Warm |
| | 5 | Sample (230, 25.4 A, 26.5 °C) | A5 | `80` | Safe, EPO latched |
| | 6 | Press P0, release | — | `00` | Reset accepted |
| C12 | 1 | Hold P0 down (`-i 0x01`) | — | — | Button held from the start |
| | 2 | Sample (230, 32.2 A, 25.0 °C) | A5 | `C0` | Trip while the button is held |
| | 3 | Sample (230, 25.4 A, 25.0 °C) | A5 | `80` | Safe, but a held button does not reset |
| | 4 | Release P0, then press again | — | `00` | A new press resets |


Replies are listed in the order the chip sends them; `./emu -r4` shows the first byte as the
least significant (e.g. C01 STATUS is `-r4 0x007F3540`).

## Verified `./emu` command lines (C01–C12)

Each line was printed by the final self-checking testbench after the corresponding case passed. All 12 are also verified by `emu.sh --all` against the organizer emulator option semantics in simulation.

**C01 Normal temperature and current**
```
./emu -d 0xF0 -t4 0x357FE65A -t2 0xF550 -r1 0xA5 -o 0x00 -t4 0x13B00050 -r4 0x007F3540
```

**C02 Warm boundaries (Temp)**
```
./emu -d 0xF0 -t4 0x367FE65A -t2 0xC533 -r1 0xA5 -o 0x10 -t4 0x407FE65A -t2 0xDB62 -r1 0xA5 -o 0x10 -t4 0x13B00050 -r4 0x007F4041
```

**C03 Temperature Critical**
```
./emu -d 0xF0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0 -t4 0x13B00050 -r4 0x017F414B
```

**C04 Current boundaries**
```
./emu -d 0xF0 -t4 0x327FE65A -t2 0x85B7 -r1 0xA5 -o 0x00 -t4 0x3280E65A -t2 0x8648 -r1 0xA5 -o 0x40 -t4 0x32A0E65A -t2 0x80AE -r1 0xA5 -o 0x40
```

**C05 Current Critical**
```
./emu -d 0xF0 -t4 0x32A1E65A -t2 0xB39F -r1 0xA5 -o 0xC0 -t4 0x13B00050 -r4 0x01A1324C
```

**C06 Either fault is sufficient**
```
./emu -d 0xF0 -t4 0x41A1E65A -t2 0xFD6B -r1 0xA5 -o 0xE0 -t4 0x32A1E65A -t2 0xB39F -r1 0xA5 -o 0xC0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0
```

**C07 Both must become Normal**
```
./emu -d 0xF0 -t4 0x41A1E65A -t2 0xFD6B -r1 0xA5 -o 0xE0 -t4 0x3680E65A -t2 0xC6CC -r1 0xA5 -o 0xD0 -t4 0x357FE65A -t2 0xF550 -r1 0xA5 -o 0x80 -i 0x01 -o 0x00 -i 0x00
```

**C08 Warm temperature blocks recovery**
```
./emu -d 0xF0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0 -t4 0x407FE65A -t2 0xDB62 -r1 0xA5 -o 0x90 -t4 0x357FE65A -t2 0xF550 -r1 0xA5 -o 0x80 -i 0x01 -o 0x00 -i 0x00
```

**C09 Warning current blocks recovery**
```
./emu -d 0xF0 -t4 0x32A1E65A -t2 0xB39F -r1 0xA5 -o 0xC0 -t4 0x3280E65A -t2 0x8648 -r1 0xA5 -o 0xC0 -i 0x01 -o 0xC0 -i 0x00 -t4 0x327FE65A -t2 0x85B7 -r1 0xA5 -o 0x80 -i 0x01 -o 0x00 -i 0x00
```

**C10 Invalid packets**
```
./emu -d 0xF0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0 -t4 0x007FE65A -t2 0x93A6 -r1 0x3C -o 0xA0 -t4 0x357FE65A -t2 0xF551 -r1 0x5A -o 0xA0
```

**C11 P0 reset refused until temperature and current are safe**
```
./emu -d 0xF0 -t4 0x417FE65A -t2 0xCB43 -r1 0xA5 -o 0xA0 -i 0x01 -o 0xA0 -i 0x00 -t4 0x367FE65A -t2 0xC533 -r1 0xA5 -o 0x90 -i 0x01 -o 0x90 -i 0x00 -t4 0x357FE65A -t2 0xF550 -r1 0xA5 -o 0x80 -i 0x01 -o 0x00 -i 0x00
```

**C12 A held P0 button never clears the EPO**
```
./emu -d 0xF0 -i 0x01 -t4 0x32A1E65A -t2 0xB39F -r1 0xA5 -o 0xC0 -t4 0x327FE65A -t2 0x85B7 -r1 0xA5 -o 0x80 -i 0x00 -i 0x01 -o 0x00 -i 0x00
```


