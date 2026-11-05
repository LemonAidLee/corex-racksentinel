# STAGES_AND_BUGS.md — Build History, Bugs & Test Reproduction

> **9 Sep 2026:** the export location is now `design-2026.09.09/` (supersedes
> `design-2026.09.08/`, referenced throughout this file). All values below are
> re-verified unchanged in the new export — the 11 non-memory modules, instance names,
> masks and reset vector are byte-identical. The one difference is the memory modules:
> `design-2026.09.09/` ships `IMEM_MOCK.v`/`DMEM_MOCK.v` (a disclosed OpenLane-only
> substitution, see PLATFORM_NOTES.md), not the `IMEM_FIRMWARE.v`/`DMEM.v` that every
> stage below — including the Stage 6 firmware PASS — was actually run and verified
> against.

> **Read this note first.** This file records the six-stage incremental bring-up as it was
> performed. The design export `design-2026.09.08/` uses a **different block
> decomposition** from the one these stages were built on: the separate PC/IR registers,
> adders, splitters and muxes have been consolidated into `PC_Unit` and `Datapath_Mux`,
> and the immediate-select decoder is gone (`IMM_GENERATOR` decodes the opcode itself).
> Where a stage below names a block that does not exist in the export, the *function*
> still exists — it has just moved inside a larger module. Block names have been
> annotated accordingly.
>
> Every **value** in this file that can be checked against the export (addresses,
> encodings, constants, the PASS/FAIL convention) has been re-verified against
> `rtl/IMEM_FIRMWARE.v` and `rtl/top.v`. One value was wrong and has been corrected: the
> CRC reference is **`0x1E82`**, not `0x1E88`.

## Signal-name mapping, old notes → exported design

| These notes say | In the export it is |
|---|---|
| `pc_o` | `PC_Unit.o_PC`, brought out as top-level `o_PC` |
| `ir_o` | `Datapath_Mux.o_IR` |
| `state_o` | `Control_Unit.o_State`, brought out as top-level `o_State` |
| `reg_we_i` | `Control_Unit.o_RD_We`, brought out as top-level `o_RD_We` |
| `rd_addr_i` / `rd_data_i` | `Datapath_Mux.o_RD_Addr` / `o_WB_Data` |
| `wb_sel_o` | `Control_Unit.o_WB_Sel` |
| `pc_src_o` | `Control_Unit.o_PC_Src` |
| `ALU.Q` | `alu.q_o` |
| `byte_write_i` | `LSU.byte_write_i` (unchanged) |
| `dmem_rdata_o` | `DMEM.o_Data` |
| Register_file instance `blk3650_34` | **`blk2832_43`** |

Reset: these notes describe an active-low `rst_n_i` with an inverter into the Control
Unit. **The export has a single active-high `rst_i` wired directly to every sequential
block, and no inverter.** Any stage instruction below that says "release reset by driving
`rst_n_i` high" means, on the export, "release reset by driving `rst_i` **low**".

---

## Stage 1 — Fetch Loop ✅

**Function under test:** PC → IMEM → IR → PC+4.
**Blocks (export equivalents):** `PC_Unit`, `Datapath_Mux` (instruction register),
`Address_Decoder`, `IMEM_FIRMWARE`, `Control_Unit`, `LSU` (address alignment only).

**Expected:** `o_State` cycles 0→1→2→3; `o_PC` steps `0x00400000` → `…04` → `…08`, once
per instruction at writeback; the instruction register captures each fetched word.

**BUG FOUND:** the instruction-register write-enable connection
(`Control_Unit.o_IR_Write` → instruction register) was missing, so the IR stayed at its
reset value `0x00000013` (NOP) forever. Fixed by adding the connection.

*Confirmed against the export:* `PC_Unit.c_RESET_VECTOR = 32'h0040_0000`;
`Datapath_Mux` resets `r_IR` to `32'h0000_0013` and loads on `i_IR_Write`;
`Control_Unit` asserts `o_IR_Write` only in `S_FETCH`.

## Stage 2 — Register / ALU Datapath ✅

**Added:** `Register_File`, `IMM_GENERATOR`, ALU operand muxes and write-back mux (now
inside `Datapath_Mux`), `alu`.

**Test program:** `addi x5, x0, 10` / `addi x6, x0, 5` / `add x7, x5, x6`.
**Expected:** `alu.q_o` = `0x0000000F` during the add; x7 = `0x0000000F` (15).

**BUG (transient):** ALU output and register reads initially showed `X` — a missing
connection; resolved once all mux/ALU/write-back wires were complete.

*Confirmed against the export:* `Datapath_Mux.o_ALU_A = i_ALU_SrcA ? i_PC : i_RS1`,
`o_ALU_B = i_ALU_SrcB ? i_Immediate : i_RS2`; `Control_Unit` sets `o_ALU_SrcB = 1` for
`OP_IMM` and `0` for `OP_REG`.

## Stage 3 — Branches & Jumps ✅

**Added:** `BRANCH_COMPARATOR` (select = `Datapath_Mux.o_Funct3`), `alu.q_o` into the
next-PC mux inside `PC_Unit`, PC+4 into the write-back mux.

**Test program:** `addi x5,10` / `addi x6,10` / `beq x5,x6,+8` / `addi x5,99` (skipped) /
`addi x7,1` / `jal x1,+8` / `addi x5,99` (skipped) / `addi x8,2`.
**Expected:** `o_PC` skips `0x…08` → `0x…10` (branch taken) and `0x…14` → `0x…1C` (jump);
`o_PC_Src` pulses to 1 twice; x5 stays 10; x7 = 1, x8 = 2, x1 = return address.
**Result:** all correct.

*Confirmed against the export:* `PC_Unit` next-PC mux — `0` = PC+4, `1` = ALU result,
`2` = `{ALU[31:1],1'b0}` for JALR; `Control_Unit` sets `o_PC_Src = i_Branch_Taken ? 1 : 0`
for `OP_BRANCH`, `1` for JAL, `2` for JALR, and `o_WB_Sel = 4` (PC+4) for both jumps.

## Stage 4 — Memory (Load/Store) ✅

**Added:** `DMEM`, `LSU`; the address mux made 2-way (ALU result as well as PC).

**Test program:** `addi x5,x0,100` / `lui x6,0x10010` / `sw x5,0(x6)` / `lw x7,0(x6)`.
**Expected:** `LSU.byte_write_i` = `1111` during SW; `LSU.mem_data_o` = `0x64`;
`DMEM.o_Data` = `0x64` after the read edge; `LSU.core_data_i` = `0x64`; x7 = `0x64` (100).
**Result:** round-trip correct.

*Confirmed against the export:* `LSU` funct3 `010` (SW) drives `byte_write_i = 4'b1111`;
`DMEM` base decoding at `0x10010000` with mask `0xFFFFE000`.

> **Correction to the old note:** it said `LSU.mem_address_i` was left unconnected. In the
> export it **is** connected — `LSU.mem_address_i` → `Address_Decoder.i_core_address` —
> so the LSU performs the 4-byte alignment for every access, fetch included.

## Stage 5 — Multiplier & CRC ✅

**Added:** `MULT_Unit` and `CRC16_Unit`, both hanging off `o_rs1_data`/`o_rs2_data`;
write-back mux selects 2 (MUL) and 3 (CRC).

**Test program:** `addi x5,x0,7` / `addi x6,x0,6` / `mul x7,x5,x6` / `crcb x8,x6,x5`.
**Expected:** `MULT_Unit.o_Result` = `0x2A` (42); `o_WB_Sel` = 2 during MUL, 3 during
CRCB; x7 = `0x2A`; x8 = `0x000067C6`.

*Value re-verified:* CRCB with rs1 = 6 (data byte) and rs2 = 7 (seed) over polynomial
`0x1021` gives **`0x67C6`** — the recorded value is correct.

**BUG FOUND:** the first CRCB encoding used was `0x40530433`, i.e. funct7 = `0100000`,
which the Control Unit correctly decodes as SUB/SRA rather than CRC, so `o_WB_Sel` never
reached 3. The correct CRCB encoding needs funct7 = `1000000` → `0x80530433`. After the
fix `o_WB_Sel` = 3 and the CRC result routed correctly.

*Confirmed against the export:* `Control_Unit` computes
`w_Is_Crc = (opcode == OP_REG) && (funct7 == 7'b1000000)` and
`w_Is_Alt = (funct7 == 7'b0100000)`, so a `0100000` CRC attempt does decode as SUB/SRA
exactly as observed.

## Stage 6 — Full Firmware Validation ✅ PASS

**Firmware:** 259 ROM words (254 instructions + 5 data constants), `0x00400000`–`0x00400408`.
**Testbench:** `#50000 $finish` (254 instrs × 4 cycles × 10 ns ≈ 10.2 µs).

**How to read the result** — `o_PC` settles into a self-loop:
- **`0x004003EC` = PASS** (x4 = `0x00000000`)
- **`0x004003F4` = FAIL** (x4 = `0xFFFFFFFF`)

*Confirmed against the export:* `r_Rom[250] = 0x00000213` (`addi x4,x0,0`),
`r_Rom[251] = 0x0000006F` (`jal x0,0`), `r_Rom[252] = 0xFFF00213` (`addi x4,x0,-1`),
`r_Rom[253] = 0x0000006F`.

### BUG FOUND (the significant one) — load from IMEM

- First firmware run FAILED: `o_PC` settled at `0x004003F4`.
- Traced to the `bne x10, x17` at **`0x00400374`** (`r_Rom[221] = 0x07151E63`), where the
  computed x10 did not equal the expected x17.
- x17 is built immediately before it: `lui x17, 0x2` (`0x000028B7`) then
  `addi x17, x17, -382` (`0xE8288893`) → **x17 = `0x00001E82`**.
- x10 comes from two chained CRCW operations at `0x00400364` and `0x00400368`
  (`0x80A32533`, `0x80A3A533` — funct7 `1000000`, funct3 `2`), whose inputs x6 and x7 came
  from loads of the IMEM data section at `0x004003F8` / `0x004003FC`.
- **x6 loaded `0x004003F8` (the address) instead of `0x12345678` (the data at it).**
- **Root cause:** the LSU load-data input was wired to the DMEM read output alone, so a
  load targeting an IMEM address never saw ROM data.
- **Fix:** wire `LSU.mem_data_i` ← `Address_Decoder.o_core_data`, which muxes IMEM or
  DMEM by address. `DMEM.o_Data` then goes *only* to the decoder.
- **After the fix:** x6 = `0x12345678`, x7 = `0x90ABCDEF`, the CRC chain produced
  **`0x1E82`**, the `bne` was not taken, and the firmware **PASSED**
  (`o_PC` = `0x004003EC`, x4 = 0).
- **Not a CRC bug** — the CRC unit computed correctly on the wrong data it was fed. This
  was an integration bug in the memory read path.

*Confirmed against the export:* net `w_44` is driven by `Address_Decoder.o_core_data` and
loads **both** `LSU.mem_data_i` and `Datapath_Mux.i_Instruction_In`; `DMEM.o_Data`
(`w_53`) drives only `Address_Decoder.i_dmem_data`. **The fix is present in the exported
design.**

> **Correction:** earlier revisions of this file, EXPLAIN_LIKE_IM_FIVE.md and
> visual-guide.html recorded the expected CRC value as `0x1E88`. The firmware itself
> computes `0x2000 − 382 = 0x1E82`, and CRC-16/CCITT-FALSE over
> `12 34 56 78 90 AB CD EF` from seed `0xFFFF` is also `0x1E82`. Report section 4.6 says
> `0x1E82`. **`0x1E82` is correct.**

## Key debugging techniques used

- **Reading a register without exposing the array:** watch the destination address
  (`Datapath_Mux.o_RD_Addr`), the write data (`o_WB_Data`) and the write enable
  (`Control_Unit.o_RD_We`, also top-level `o_RD_We`) together. The value on the write-data
  bus at the *rising* clock edge while write-enable is high is what the register receives.
  Register numbers in hex: x4 = `4`, x10 = `a`, x17 = `11`.
- **Reading PASS/FAIL fast:** watch where `o_PC` settles (`0x4003EC` vs `0x4003F4`).
- **`X` propagation:** an `X` means undriven; trace upstream to the first signal that goes
  `X` — that is the missing wire.
- **Width-mismatch warnings** ("port expects 32 bits, got 1") almost always mean a wire
  landed on the wrong adjacent pin.

## Snapshot naming convention used

`CPU_M5_S1_Fetch`, `CPU_M5_S2_Datapath`, `CPU_M5_S3_BranchJump`, `CPU_M5_S4_Memory`,
`CPU_M5_S5_MulCRC`, `CPU_M5_S6_FirmwarePASS` — one snapshot after each passing stage so a
later change can be rolled back.
