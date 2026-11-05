# ARCHITECTURE.md — CPU Structure & Module Reference

> **Source of truth:** the ChipInventor design export in `design-2026.09.09/design/`
> (exported 9 Sep 2026, converter 3.15; supersedes `design-2026.09.08/`). Where this file
> once disagreed with the RTL, the RTL wins and this file has been rewritten to match it.
> Per-module source: `design-2026.09.09/design/rtl/*.v`. Flattened design: `hdl.v`
> (byte-identical to `rtl/top.v` and `simulate.v`).
>
> **One difference from the 8 Sep export:** `rtl/IMEM_FIRMWARE.v` and `rtl/DMEM.v` are
> replaced here by `IMEM_MOCK.v` (3-instruction placeholder) and `DMEM_MOCK.v`, used only
> for the OpenLane physical-implementation run — see PLATFORM_NOTES.md. All 11 other
> modules, every port below, every instance name, the address masks and the reset vector
> are re-verified identical in this export, so this file's module reference and memory
> map still apply as written.

## Instruction Set: RV32I + Zmmul + Xicrc

- **RV32I** — base 32-bit integer ISA: arithmetic/logic (register & immediate), loads (LW/LH/LB/LHU/LBU), stores (SW/SH/SB), branches (BEQ/BNE/BLT/BGE/BLTU/BGEU), jumps (JAL/JALR), upper-immediate (LUI/AUIPC). FENCE/ECALL/EBREAK decode to a no-op (`default` arm of the Control Unit) — the System/Synchronization category was cancelled by the organizer.
- **Zmmul** — multiply-only subset of M: MUL, MULH, MULHSU, MULHU (`funct7 = 0000001`).
- **Xicrc** — custom CRC extension: CRCB, CRCH, CRCW (`funct7 = 1000000`). All three are **CRC-16-CCITT** (polynomial `0x1021`) and differ only in how many bits of rs1 they consume (8 / 16 / 32). The result is always `{16'h0, crc16}`.

**Instruction count: 44** (10 register ALU + 9 immediate ALU + 5 load + 3 store + 6 branch + 2 jump + 2 upper-immediate + 4 Zmmul + 3 Xicrc).

## Multicycle FSM (4 states)

FETCH (0) → DECODE (1) → EXECUTE (2) → WRITEBACK (3) → back to FETCH. One state per clock, so every instruction takes exactly 4 clock cycles. The state register lives in `Control_Unit` and is exposed on the top-level port `o_State`.

- **FETCH:** `o_Addr_Src=0` (address = PC), `o_Mem_Oe=1` (read IMEM), `o_IR_Write=1` (capture instruction at end of cycle).
- **DECODE:** no control pulses. Register reads are asynchronous and the immediate generator is combinational, so operands settle on their own.
- **EXECUTE:** ALU computes the result / memory address / branch target. Loads assert `o_Mem_Oe` (giving DMEM its read edge); stores assert `o_Mem_We`.
- **WRITEBACK:** `o_PC_Write=1` always; `o_RD_We` and `o_WB_Sel` set per opcode.

## Memory Map

| Region | Base | Implemented size | Notes |
|---|---|---|---|
| IMEM | `0x00400000` | 1024 words (4 kB) | ROM, combinational read. Decoded over a 4 MB window. |
| DMEM | `0x10010000` | 2048 words (8 kB) | SRAM, **synchronous** read, byte-masked write. |

Address Decoder masks: `IMEM_MASK = 0xFFC00000`, `DMEM_MASK = 0xFFFFE000`.
Reset vector / firmware start: `0x00400000`.

---

## Top Level — `top`

```verilog
module top (
    input  wire        clk_i,
    input  wire        rst_i,        // ACTIVE HIGH
    output wire [31:0] o_PC,
    output wire [1:0]  o_State,
    output wire        o_RD_We
);
```

> ⚠️ **Reset is active-HIGH and is wired directly to every sequential block.**
> There is no `rst_n_i`, and there is no inverter anywhere in the design. `rst_i` goes
> straight to `Control_Unit.i_Rst`, `PC_Unit.i_Rst`, `Register_File.i_rst` and
> `Datapath_Mux.i_Rst`. (Earlier revisions of this documentation described an
> active-low system reset with an inverter feeding the Control Unit — that is not
> what the exported design does.)

`o_PC`, `o_State` and `o_RD_We` are brought out purely for observability in simulation.

## Complete Block List — 13 instances

The canvas holds 18 nodes: these 13 module instances plus 2 input ports (`clk_i`, `rst_i`)
and 3 output ports (`o_PC`, `o_State`, `o_RD_We`).

| Module | Canvas instance | Role |
|---|---|---|
| `Control_Unit` | `blk3000_35` | 4-state FSM + full control word |
| `PC_Unit` | `blk3324_39` | PC register, +4 adder, next-PC mux |
| `Datapath_Mux` | `blk3326_45` | Instruction register, field extraction, all four operand/address/write-back muxes |
| `alu` | `blk2723_40` | 11-operation ALU |
| `Register_File` | `blk2832_43` | 32 × 32-bit, dual async read, sync write |
| `IMM_GENERATOR` | `blk2830_47` | Immediate decode (opcode-driven) |
| `BRANCH_COMPARATOR` | `blk2820_37` | 6 branch conditions |
| `MULT_Unit` | `blk2761_41` | Zmmul |
| `CRC16_Unit` | `blk2756_42` | Xicrc |
| `LSU` | `blk2775_44` | Alignment, byte masking, sign/zero extension |
| `Address_Decoder` | `blk2847_46` | IMEM/DMEM routing and read-data mux |
| `IMEM_FIRMWARE` | `blk3583_57` | 1024-word ROM preloaded with the validation firmware |
| `DMEM` | `blk2976_48` | 2048-word byte-writable SRAM |

> **There is no `ir_splitter`, no `Imm_Sel_Decoder`, no standalone `PC_Register`,
> `IR_Register`, `PC_Plus4_Adder`, `PC_Src_Mux`, `addr_mux`, `alu_srca_mux`,
> `alu_srcb_mux` or `WB_Mux`, and no inverter or constant blocks.** Those functions are
> absorbed into `PC_Unit` and `Datapath_Mux`. Field extraction (`rs1`, `rs2`, `rd`,
> `funct3`) happens inside `Datapath_Mux` by direct bit-slicing of the instruction
> register, so the platform's inability to bit-slice a top-level wire never arises.

---

## `PC_Unit` — program counter

Ports: `i_Clk`, `i_Rst`, `i_PC_Write`, `i_PC_Src[1:0]`, `i_ALU_Result[31:0]` → `o_PC[31:0]`, `o_PC_Plus4[31:0]`

- Reset vector `c_RESET_VECTOR = 32'h0040_0000`.
- `o_PC_Plus4` is a continuous assign (`r_PC + 4`), always available.
- Next-PC mux: `0` = PC+4, `1` = `i_ALU_Result` (branch taken / JAL), `2` = `{i_ALU_Result[31:1], 1'b0}` (JALR, bit 0 cleared), default = PC+4.
- PC updates only when `i_PC_Write` is asserted (WRITEBACK).

## `Datapath_Mux` — instruction register + all muxing

Ports in: `i_Clk`, `i_Rst`, `i_IR_Write`, `i_Instruction_In[31:0]`, `i_PC`, `i_PC_Plus4`, `i_RS1`, `i_RS2`, `i_Immediate`, `i_ALU_Result`, `i_LSU_Data`, `i_Mul_Result`, `i_CRC_Result`, `i_ALU_SrcA`, `i_ALU_SrcB`, `i_Addr_Src`, `i_WB_Sel[2:0]`
Ports out: `o_IR[31:0]`, `o_ALU_A`, `o_ALU_B`, `o_Address`, `o_WB_Data`, `o_RS1_Addr[4:0]`, `o_RS2_Addr[4:0]`, `o_RD_Addr[4:0]`, `o_Funct3[2:0]`

- **Instruction register:** resets to `32'h0000_0013` (NOP), loads `i_Instruction_In` when `i_IR_Write`.
- **Field extraction:** `o_RS1_Addr = r_IR[19:15]`, `o_RS2_Addr = r_IR[24:20]`, `o_RD_Addr = r_IR[11:7]`, `o_Funct3 = r_IR[14:12]`.
- **Operand muxes:** `o_ALU_A = i_ALU_SrcA ? i_PC : i_RS1`; `o_ALU_B = i_ALU_SrcB ? i_Immediate : i_RS2`; `o_Address = i_Addr_Src ? i_ALU_Result : i_PC`.
- **Write-back mux** (`i_WB_Sel`): 0=ALU, 1=LSU, 2=Multiplier, 3=CRC, 4=PC+4, default `32'h0`.

## `alu`

Ports: `a_i[31:0]`, `b_i[31:0]`, `sel_i[3:0]` → `q_o[31:0]`. Shift amount is `b_i[4:0]`.

| sel | Op | | sel | Op |
|---|---|---|---|---|
| 0 | PASS_B (`q_o = b_i`) | | 6 | SLL |
| 1 | ADD | | 7 | SRL |
| 2 | SUB | | 8 | MRS = SRA (`$signed(a_i) >>> shamt`) |
| 3 | AND | | 9 | SLT (signed) |
| 4 | OR | | A | SLTU (unsigned) |
| 5 | XOR | | | |

**11 operations, not 10** — `PASS_B` (sel 0) is an extra used to route the immediate straight through for LUI. The 10 required RV32I operations are sel 1–A.

## `Register_File`

Ports: `i_clk`, `i_rst`, `i_we`, `i_rs1_addr[4:0]`, `i_rs2_addr[4:0]`, `i_rd_addr[4:0]`, `i_rd_data[31:0]` → `o_rs1_data[31:0]`, `o_rs2_data[31:0]`

- Array `reg [31:0] registers [0:31]`. **Instance is `blk2832_43`** (not `blk3650_34`).
- Asynchronous read with x0 intercepted by ternary (`addr == 0 ? 32'd0 : registers[addr]`).
- Synchronous write on posedge `i_clk`, gated by `i_we` **and** `i_rd_addr != 0`.
- `i_rst` is **active high** and clears `registers[1..31]` (x0 is never written).

## `IMM_GENERATOR`

Ports: `i_Instruction[31:0]` → `o_Immediate[31:0]`. **Combinational, no select input.**

> ⚠️ The module decodes `i_Instruction[6:0]` (the opcode) itself. There is **no
> `imm_sel_i` port** and no separate immediate-select decoder. Report section 4.3
> describes a 3-bit `imm_sel_i` input — that does not match this RTL.

| Opcode | Format | Handling |
|---|---|---|
| `1101111` JAL | J | `{i[31], i[19:12], i[20], i[30:25], i[24:21], 1'b0}`, sign-extended |
| `1100011` BRANCH | B | `{i[31], i[7], i[30:25], i[11:8], 1'b0}`, sign-extended |
| `0100011` STORE | S | `{i[31:25], i[11:7]}`, sign-extended |
| `0110111` LUI / `0010111` AUIPC | U | `{i[31:12], 12'b0}`, **no** sign extension |
| default | I | `i[31:20]`, sign-extended |

## `BRANCH_COMPARATOR`

Ports: `i_Reg_A[31:0]`, `i_Reg_B[31:0]`, `i_Branch_Sel[2:0]` → `o_Branch_Taken`

`i_Branch_Sel` is funct3: 000=BEQ, 001=BNE, 100=BLT, 101=BGE, 110=BLTU, 111=BGEU; anything else → 0.
Signed comparison is derived from the sign bits: `w_LT_Signed = (A[31] ^ B[31]) ? A[31] : w_LT_Unsigned`.

## `MULT_Unit`

Ports: `i_rs1[31:0]`, `i_rs2[31:0]`, `i_Mul_Op[3:0]` → `o_Result[31:0]`

Computes one unsigned 64-bit product and applies sign corrections rather than instantiating three multipliers:
`prod_uu = rs1 * rs2`; `corr_a = rs1[31] ? {rs2,32'h0} : 0`; `corr_b = rs2[31] ? {rs1,32'h0} : 0`;
`prod_ss = prod_uu - corr_a - corr_b`, `prod_su = prod_uu - corr_a`.

| op | Instruction | Result |
|---|---|---|
| 0 | MUL | `prod_ss[31:0]` |
| 1 | MULH | `prod_ss[63:32]` |
| 2 | MULHSU | `prod_su[63:32]` |
| 3 | MULHU | `prod_uu[63:32]` |

## `CRC16_Unit`

Ports: `i_rs1[31:0]` (data), `i_rs2[31:0]` (running CRC state), `i_CRC_Op[3:0]` → `o_Result[31:0]`

Seed is `i_rs2[15:0]`; bits of `i_rs1` are consumed MSB-first; polynomial `0x1021`.
op 0 = CRCB (bits 7..0), op 1 = CRCH (bits 15..0), op 2 = CRCW (bits 31..0). Result `{16'd0, crc}`.

> Note: the in-code comment says "current CRC state from rs1" — the code uses `i_rs2[15:0]`.
> The **code** is correct and matches the report.

## `LSU` — ⚠️ pins named from the CORE's perspective

Trust the `input`/`output` keyword, **not** the `_i`/`_o` suffix.

| Pin | Direction | Meaning |
|---|---|---|
| `core_data_o[31:0]` | **input** | store data (rs2) |
| `core_address_o[31:0]` | **input** | unaligned address from `Datapath_Mux.o_Address` |
| `op_size_o[2:0]` | **input** | funct3 |
| `we_i`, `oe_i` | **input** | write / read enable from Control Unit |
| `core_data_i[31:0]` | **output** | formatted load data back to the core |
| `mem_data_i[31:0]` | **input** | raw read word ← `Address_Decoder.o_core_data` |
| `mem_address_i[31:0]` | **output** | 4-byte-aligned address → `Address_Decoder.i_core_address` |
| `byte_write_i[3:0]` | **output** | byte-enable mask → `Address_Decoder.i_core_bw` |
| `mem_data_o[31:0]` | **output** | formatted store data → `DMEM.i_Data` |

> ⚠️ `mem_address_i` is **connected**, and the LSU therefore sits *inside* the address
> path: `Datapath_Mux.o_Address → LSU.core_address_o → LSU.mem_address_i →
> Address_Decoder.i_core_address`. Earlier documentation claimed this pin was left
> unconnected; it is not.

Stores (gated by `we_i`): funct3 000 = SB (mask 0001/0010/0100/1000 by offset), 001 = SH (0011/1100), 010 = SW (1111); anything else writes nothing.
Loads: 000 = LB, 001 = LH, 010 = LW, 100 = LBU, 101 = LHU; byte/half selected by `core_address_o[1:0]`.

## `Address_Decoder`

Ports in: `i_core_address[31:0]`, `i_core_we`, `i_core_oe`, `i_core_bw[3:0]`, `i_imem_data[31:0]`, `i_dmem_data[31:0]`
Ports out: `o_imem_address`, `o_imem_oe`, `o_dmem_address`, `o_dmem_we`, `o_dmem_oe`, `o_dmem_bw[3:0]`, `o_core_data[31:0]`

Fully combinational with defaults assigned first to prevent latches. Both memory addresses are aligned (`{addr[31:2], 2'b00}`).

- IMEM hit (`(addr & 0xFFC00000) == 0x00400000`): routes `i_core_oe → o_imem_oe`, `o_core_data = i_imem_data`. **`we`/`bw` are never routed to IMEM.**
- DMEM hit (`(addr & 0xFFFFE000) == 0x10010000`): routes `oe`, `we`, `bw`, and `o_core_data = i_dmem_data`.
- Unmapped: all enables low, `o_core_data = 32'd0`.

`o_core_data` is the **single** read path back into the core, and it feeds **both** the
instruction register and the LSU load port. That is what allows loads to read constants
out of the IMEM data section.

## `IMEM_FIRMWARE`

Ports: `i_Address[31:0]`, `i_Oe` → `o_Data[31:0]`. 1024 words (4 kB). Word index `i_Address[11:2]`.
Read is **combinational** (`assign o_Data = r_Rom[w_Index]`); `i_Oe` is routed per the block
guide but is *unused internally*. The array is filled with NOP `32'h0000_0013` and then
overwritten with 259 words of the official Stage 2 validation firmware.

There is only this one IMEM in the export — no mock/3-instruction variant is present.

## `DMEM`

Ports: `i_Clk`, `i_Address[31:0]`, `i_We`, `i_Oe`, `i_Bw[3:0]`, `i_Data[31:0]` → `o_Data[31:0]`
2048 words (8 kB), word index `i_Address[12:2]`. Read is **synchronous** — `o_Data` is
registered on posedge when `i_Oe` is high, so loads carry one cycle of latency, which is
why the Control Unit holds `o_Mem_Oe` asserted through both EXECUTE and WRITEBACK.
Writes are per-byte under `i_Bw[3:0]`.

## `Control_Unit`

Ports in: `i_Clk`, `i_Rst` (**active high**), `i_Instruction[31:0]`, `i_Branch_Taken`
Ports out: `o_State[1:0]`, `o_IR_Write`, `o_PC_Write`, `o_PC_Src[1:0]`, `o_ALU_Op[3:0]`, `o_ALU_SrcA`, `o_ALU_SrcB`, `o_Mul_Op[3:0]`, `o_CRC_Op[3:0]`, `o_WB_Sel[2:0]`, `o_RD_We`, `o_Mem_We`, `o_Mem_Oe`, `o_Addr_Src`

**Decode helpers:** `w_Is_Alt = (funct7 == 0100000)` (SUB/SRA); `w_Is_Mul = OP_REG && funct7 == 0000001`; `w_Is_Crc = OP_REG && funct7 == 1000000`; `w_Is_AluR = OP_REG && !mul && !crc`.
`o_Mul_Op` and `o_CRC_Op` are both `{2'b00, funct3[1:0]}`.

**ALU op from funct3:** 000 → SUB if (`w_Is_AluR && w_Is_Alt`) else ADD; 001 → SLL; 010 → SLT; 011 → SLTU; 100 → XOR; 101 → SRA if `w_Is_Alt` else SRL; 110 → OR; 111 → AND.

**Per-opcode WRITEBACK behaviour:**

| Opcode | `o_RD_We` | `o_WB_Sel` | `o_PC_Src` |
|---|---|---|---|
| OP_REG | 1 | 2 if MUL, 3 if CRC, else 0 | 0 |
| OP_IMM | 1 | 0 | 0 |
| OP_LOAD | 1 | 1 | 0 |
| OP_STORE | 0 | — | 0 |
| OP_BRANCH | 0 | — | `i_Branch_Taken ? 1 : 0` |
| OP_JAL | 1 | 4 | 1 |
| OP_JALR | 1 | 4 | 2 |
| OP_LUI | 1 | 0 (ALU PASS_B) | 0 |
| OP_AUIPC | 1 | 0 (PC + imm) | 0 |
| FENCE / SYSTEM | 0 | — | 0 |

`o_PC_Write` is asserted for **every** opcode in WRITEBACK.
For OP_LOAD the Control Unit also holds `o_Addr_Src = 1` and `o_Mem_Oe = 1` through
WRITEBACK so the address stays valid while the LSU consumes the registered DMEM output.
