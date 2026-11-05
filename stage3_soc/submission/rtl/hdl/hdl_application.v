

//  ---------- INLCUDED BLOCK: alu  ---------- 
module alu (
    input  wire [31:0] a_i,
    input  wire [31:0] b_i,
    input  wire [3:0]  sel_i,
    output reg  [31:0] q_o
);
 
    // ---- Table 9 operation select ------------------------------------
    localparam [3:0] ALU_PASS_B = 4'h0;
    localparam [3:0] ALU_ADD    = 4'h1;
    localparam [3:0] ALU_SUB    = 4'h2;
    localparam [3:0] ALU_AND    = 4'h3;
    localparam [3:0] ALU_OR     = 4'h4;
    localparam [3:0] ALU_XOR    = 4'h5;
    localparam [3:0] ALU_SLL    = 4'h6;
    localparam [3:0] ALU_SRL    = 4'h7;
    localparam [3:0] ALU_MRS    = 4'h8;  // arithmetic shift right (SRA)
    localparam [3:0] ALU_SLT    = 4'h9;
    localparam [3:0] ALU_SLTU   = 4'hA;
 
    wire [4:0] shamt = b_i[4:0];
 
    always @(*) begin
        case (sel_i)
            ALU_PASS_B : q_o = b_i;
            ALU_ADD    : q_o = a_i + b_i;
            ALU_SUB    : q_o = a_i - b_i;
            ALU_AND    : q_o = a_i & b_i;
            ALU_OR     : q_o = a_i | b_i;
            ALU_XOR    : q_o = a_i ^ b_i;
            ALU_SLL    : q_o = a_i << shamt;
            ALU_SRL    : q_o = a_i >> shamt;
            ALU_MRS    : q_o = $signed(a_i) >>> shamt;
            ALU_SLT    : q_o = ($signed(a_i) < $signed(b_i)) ? 32'd1 : 32'd0;
            ALU_SLTU   : q_o = (a_i < b_i)                   ? 32'd1 : 32'd0;
            default    : q_o = 32'h0000_0000;
        endcase
    end
 
endmodule



//  ---------- INLCUDED BLOCK: CRC16_Unit  ---------- 
`timescale 1ns / 1ps

module CRC16_Unit (
    input  wire [31:0] i_rs1,     // Data payload
    input  wire [31:0] i_rs2,     // Running CRC state
    input  wire [3:0]  i_CRC_Op,  // Operation selector from Control Unit
    output reg  [31:0] o_Result
);

    reg [15:0] temp_crc;
    integer i;

    always @(*) begin
        // Start with the current CRC state from rs1
        temp_crc = i_rs2[15:0]; 
        
       case (i_CRC_Op)
            4'h0: begin // CRCB: 8 bits from rs1
                for (i = 7; i >= 0; i = i - 1) begin
                    if (temp_crc[15] ^ i_rs1[i])
                        temp_crc = (temp_crc << 1) ^ 16'h1021;
                    else
                        temp_crc = temp_crc << 1;
                end
                o_Result = {16'd0, temp_crc};
            end
            4'h1: begin // CRCH: 16 bits from rs1
                for (i = 15; i >= 0; i = i - 1) begin
                    if (temp_crc[15] ^ i_rs1[i])
                        temp_crc = (temp_crc << 1) ^ 16'h1021;
                    else
                        temp_crc = temp_crc << 1;
                end
                o_Result = {16'd0, temp_crc};
            end
            4'h2: begin // CRCW: 32 bits from rs1
                for (i = 31; i >= 0; i = i - 1) begin
                    if (temp_crc[15] ^ i_rs1[i])
                        temp_crc = (temp_crc << 1) ^ 16'h1021;
                    else
                        temp_crc = temp_crc << 1;
                end
                o_Result = {16'd0, temp_crc};
            end
            default: o_Result = 32'd0;
        endcase
    end
endmodule



//  ---------- INLCUDED BLOCK: MULT_Unit  ---------- 
module MULT_Unit (
    input  wire [31:0] i_rs1,
    input  wire [31:0] i_rs2,
    input  wire [3:0]  i_Mul_Op,   // Table 10 selector
    output reg  [31:0] o_Result
);
 
    // Table 10 operation select
    localparam [3:0] OP_MUL    = 4'h0;  // rd = (rs1_s * rs2_s)[31:0]
    localparam [3:0] OP_MULH   = 4'h1;  // rd = (rs1_s * rs2_s)[63:32]
    localparam [3:0] OP_MULHSU = 4'h2;  // rd = (rs1_s * rs2_u)[63:32]
    localparam [3:0] OP_MULHU  = 4'h3;  // rd = (rs1_u * rs2_u)[63:32]
 
    wire [63:0] prod_uu;
    wire [63:0] corr_a;      // correction for rs1 being negative
    wire [63:0] corr_b;      // correction for rs2 being negative
 
    assign prod_uu = i_rs1 * i_rs2;
    assign corr_a  = i_rs1[31] ? {i_rs2, 32'h0000_0000} : 64'd0;
    assign corr_b  = i_rs2[31] ? {i_rs1, 32'h0000_0000} : 64'd0;
 
    wire [63:0] prod_ss;     // both signed
    wire [63:0] prod_su;     // rs1 signed, rs2 unsigned
    wire [63:0] prod_uu_r;   // both unsigned
 
    assign prod_ss   = prod_uu - corr_a - corr_b;
    assign prod_su   = prod_uu - corr_a;
    assign prod_uu_r = prod_uu;
 
    always @(i_Mul_Op or prod_ss or prod_su or prod_uu_r) begin
        case (i_Mul_Op)
            OP_MUL    : o_Result = prod_ss[31:0];
            OP_MULH   : o_Result = prod_ss[63:32];
            OP_MULHSU : o_Result = prod_su[63:32];
            OP_MULHU  : o_Result = prod_uu_r[63:32];
            default   : o_Result = 32'h0000_0000;
        endcase
    end
 
endmodule



//  ---------- INLCUDED BLOCK: LSU  ---------- 
`timescale 1ns / 1ps
module LSU (
    // Interface to RISC-V Datapath / Core
    input  wire [31:0] core_data_o,    // Data to be stored (Store instructions)
    input  wire [31:0] core_address_o, // Memory address calculated by ALU
    input  wire [2:0]  op_size_o,      // Operation size / type (funct3)
    input  wire        we_i,           // Write Enable from Control Unit
    input  wire        oe_i,           // Output Enable (Read) from Control Unit
    output reg  [31:0] core_data_i,    // Data returned to the core (Load instructions)

    // Interface to DMEM / Address Decoder
    input  wire [31:0] mem_data_i,     // Raw 32-bit word read from DMEM
    output reg  [31:0] mem_address_i,  // Aligned address sent to memory (bottom 2 bits ignored)
    output reg  [3:0]  byte_write_i,   // 4-bit byte-enable write mask for DMEM
    output reg  [31:0] mem_data_o      // Formatted data written to DMEM
);

    // Extract bottom 2 bits for byte offset within the 32-bit word
    wire [1:0] byte_offset = core_address_o[1:0];

    // Align address to 4 bytes by clearing the bottom 2 bits
    always @(*) begin
        mem_address_i = {core_address_o[31:2], 2'b00};
    end

    // ---------------------------------------------------------
    // STORE LOGIC (Writing to Memory)
    // ---------------------------------------------------------
     always @(*) begin
        mem_data_o   = 32'd0;
        byte_write_i = 4'b0000;
        if (we_i) begin
            case (op_size_o)                     // was op_size_o[1:0]
                3'b000: case (byte_offset)       // sb
                    2'b00: begin mem_data_o = {24'd0, core_data_o[7:0]};       byte_write_i = 4'b0001; end
                    2'b01: begin mem_data_o = {16'd0, core_data_o[7:0], 8'd0}; byte_write_i = 4'b0010; end
                    2'b10: begin mem_data_o = {8'd0, core_data_o[7:0], 16'd0}; byte_write_i = 4'b0100; end
                    2'b11: begin mem_data_o = {core_data_o[7:0], 24'd0};       byte_write_i = 4'b1000; end
                endcase
                3'b001: case (byte_offset[1])    // sh
                    1'b0: begin mem_data_o = {16'd0, core_data_o[15:0]};       byte_write_i = 4'b0011; end
                    1'b1: begin mem_data_o = {core_data_o[15:0], 16'd0};       byte_write_i = 4'b1100; end
                endcase
                3'b010: begin                    // sw
                    mem_data_o = core_data_o;    byte_write_i = 4'b1111;
                end
                default: begin
                    mem_data_o = 32'd0;          byte_write_i = 4'b0000;
                end
            endcase
        end
    end
    // ---------------------------------------------------------
    // LOAD LOGIC (Reading from Memory)
    // ---------------------------------------------------------
    always @(*) begin
        case (op_size_o)
            3'b000: begin // lb: Load Byte with Sign Extension
                case (byte_offset)
                    2'b00: core_data_i = {{24{mem_data_i[7]}},  mem_data_i[7:0]};
                    2'b01: core_data_i = {{24{mem_data_i[15]}}, mem_data_i[15:8]};
                    2'b10: core_data_i = {{24{mem_data_i[23]}}, mem_data_i[23:16]};
                    2'b11: core_data_i = {{24{mem_data_i[31]}}, mem_data_i[31:24]};
                endcase
            end
            3'b001: begin // lh: Load Half-word with Sign Extension
                case (byte_offset[1])
                    1'b0:  core_data_i = {{16{mem_data_i[15]}}, mem_data_i[15:0]};
                    1'b1:  core_data_i = {{16{mem_data_i[31]}}, mem_data_i[31:16]};
                endcase
            end
            3'b010: begin // lw: Load Word
                core_data_i = mem_data_i;
            end
            3'b100: begin // lbu: Load Byte Unsigned (Zero Extension)
                case (byte_offset)
                    2'b00: core_data_i = {24'd0, mem_data_i[7:0]};
                    2'b01: core_data_i = {24'd0, mem_data_i[15:8]};
                    2'b10: core_data_i = {24'd0, mem_data_i[23:16]};
                    2'b11: core_data_i = {24'd0, mem_data_i[31:24]};
                endcase
            end
            3'b101: begin // lhu: Load Half-word Unsigned (Zero Extension)
                case (byte_offset[1])
                    1'b0:  core_data_i = {16'd0, mem_data_i[15:0]};
                    1'b1:  core_data_i = {16'd0, mem_data_i[31:16]};
                endcase
            end
            default: core_data_i = mem_data_i;
        endcase
    end

endmodule



//  ---------- INLCUDED BLOCK: BRANCH_COMPARATOR  ---------- 
module BRANCH_COMPARATOR (
    input  wire [31:0] i_Reg_A,
    input  wire [31:0] i_Reg_B,
    input  wire [2:0]  i_Branch_Sel,
    output reg         o_Branch_Taken
);
    localparam c_BEQ  = 3'b000;
    localparam c_BNE  = 3'b001;
    localparam c_BLT  = 3'b100;
    localparam c_BGE  = 3'b101;
    localparam c_BLTU = 3'b110;
    localparam c_BGEU = 3'b111;

    wire w_Equal       = (i_Reg_A == i_Reg_B);
    wire w_LT_Unsigned = (i_Reg_A < i_Reg_B);
    wire w_LT_Signed   = (i_Reg_A[31] ^ i_Reg_B[31]) ? i_Reg_A[31] : w_LT_Unsigned;

    always @(*) begin
        case (i_Branch_Sel)
            c_BEQ  : o_Branch_Taken = w_Equal;
            c_BNE  : o_Branch_Taken = !w_Equal;
            c_BLT  : o_Branch_Taken = w_LT_Signed;
            c_BGE  : o_Branch_Taken = !w_LT_Signed;
            c_BLTU : o_Branch_Taken = w_LT_Unsigned;
            c_BGEU : o_Branch_Taken = !w_LT_Unsigned;
            default: o_Branch_Taken = 1'b0;
        endcase
    end
endmodule



//  ---------- INLCUDED BLOCK: IMM_GENERATOR  ---------- 
module IMM_GENERATOR (
    input      [31:0] i_Instruction,
    output reg [31:0] o_Immediate
);
    /* Instruction Opcodes */
    localparam c_OPCODE_JAL    = 7'b1101111;
    localparam c_OPCODE_BRANCH = 7'b1100011;
    localparam c_OPCODE_STORE  = 7'b0100011;
    localparam c_OPCODE_LUI    = 7'b0110111;
    localparam c_OPCODE_AUIPC  = 7'b0010111;
 
    wire [11:0] w_I_Type_Imm = i_Instruction[31:20];
    wire [11:0] w_S_Type_Imm = {i_Instruction[31:25], i_Instruction[11:7]};
    wire [12:0] w_B_Type_Imm = {i_Instruction[31], i_Instruction[7],
                                i_Instruction[30:25], i_Instruction[11:8], 1'b0};
    wire [20:0] w_J_Type_Imm = {i_Instruction[31], i_Instruction[19:12], i_Instruction[20],
                                i_Instruction[30:25], i_Instruction[24:21], 1'b0};
    // U-type is already a full 32-bit value; no sign extension.
    wire [31:0] w_U_Type_Imm = {i_Instruction[31:12], 12'b0};
 
    always @ (*) begin
        case (i_Instruction[6:0])
            c_OPCODE_JAL:    o_Immediate = $signed(w_J_Type_Imm);
            c_OPCODE_BRANCH: o_Immediate = $signed(w_B_Type_Imm);
            c_OPCODE_STORE:  o_Immediate = $signed(w_S_Type_Imm);
            c_OPCODE_LUI:    o_Immediate = w_U_Type_Imm;
            c_OPCODE_AUIPC:  o_Immediate = w_U_Type_Imm;
            default:         o_Immediate = $signed(w_I_Type_Imm);
        endcase
    end
endmodule



//  ---------- INLCUDED BLOCK: Register_File  ---------- 
`timescale 1ns / 1ps

module Register_File (
    input  wire        i_clk,         // System clock
    input  wire        i_rst,         // Reset signal
    input  wire        i_we,          // Write Enable from Control Unit
    input  wire [4:0]  i_rs1_addr,    // 5-bit address for rs1
    input  wire [4:0]  i_rs2_addr,    // 5-bit address for rs2
    input  wire [4:0]  i_rd_addr,     // 5-bit address for destination register rd
    input  wire [31:0] i_rd_data,     // 32-bit data to write back
    
    output wire [31:0] o_rs1_data,    // Data output for rs1
    output wire [31:0] o_rs2_data     // Data output for rs2
);

    // Array of 32 registers, each 32 bits wide
    reg [31:0] registers [0:31];
    integer i;

    // ---------------------------------------------------------
    // Asynchronous Read Logic
    // x0 is hardwired to 0. If the address is 0, return 32'd0.
    // ---------------------------------------------------------
    assign o_rs1_data = (i_rs1_addr == 5'd0) ? 32'd0 : registers[i_rs1_addr];
    assign o_rs2_data = (i_rs2_addr == 5'd0) ? 32'd0 : registers[i_rs2_addr];

    // ---------------------------------------------------------
    // Synchronous Write Logic
    // ---------------------------------------------------------
    always @(posedge i_clk) begin
        if (i_rst) begin
            // Clear all registers on reset (excluding x0 which is structurally 0)
            for (i = 1; i < 32; i = i + 1) begin
                registers[i] <= 32'd0;
            end
        end else if (i_we) begin
            // Only write if Write Enable is high AND the target is NOT x0[cite: 1]
            if (i_rd_addr != 5'd0) begin
                registers[i_rd_addr] <= i_rd_data;
            end
        end
    end

endmodule



//  ---------- INLCUDED BLOCK: Addr_dec  ---------- 
module Addr_dec (
    input  wire [31:0] i_core_address,
    input  wire        i_core_we,
    input  wire        i_core_oe,
    input  wire [3:0]  i_core_bw,
 
    output reg  [31:0] o_imem_address,
    output reg         o_imem_oe,
    input  wire [31:0] i_imem_data,
 
    output reg  [31:0] o_dmem_address,
    output reg         o_dmem_we,
    output reg         o_dmem_oe,
    output reg  [3:0]  o_dmem_bw,
    input  wire [31:0] i_dmem_data,
 
    // Peripherals are word-access only: they get we/oe but no byte-write mask.
    output wire [31:0] o_gpio_address,
    output wire        o_gpio_we,
    output wire        o_gpio_oe,
    input  wire [31:0] i_gpio_data,

    output wire [31:0] o_uart_address,
    output wire        o_uart_we,
    output wire        o_uart_oe,
    input  wire [31:0] i_uart_data,

    output reg  [31:0] o_core_data
);
    localparam [31:0] IMEM_BASE = 32'h00400000;
    localparam [31:0] DMEM_BASE = 32'h10010000;
    localparam [31:0] IMEM_MASK = 32'hFFC00000;   // 4 MB region
    localparam [31:0] DMEM_MASK = 32'hFFFFE000;   // 8 kB region
    localparam [31:0] GPIO_BASE = 32'hF0000000;
    localparam [31:0] UART_BASE = 32'hF1000000;
    // The guide gives no window size; 4 kB matches the peripherals' [11:2]
    // offset decode, so no address outside the window can alias a register.
    localparam [31:0] PERI_MASK = 32'hFFFFF000;

    // Peripheral selects are continuous assigns, deliberately NOT set inside
    // the always block below. There, `o_x_oe = 0; ... o_x_oe = i_core_oe;`
    // makes o_x_oe glitch every time the block runs; GPIO/UART read data is
    // combinational and gated by oe, so the glitch changes i_x_data, which
    // re-triggers the block: a zero-delay loop that hangs the simulator on
    // the first peripheral load. (DMEM has a registered read, so the DMEM
    // branch below cannot loop.)
    wire w_gpio_sel = ((i_core_address & PERI_MASK) == GPIO_BASE);
    wire w_uart_sel = ((i_core_address & PERI_MASK) == UART_BASE);

    assign o_gpio_address = {i_core_address[31:2], 2'b00};
    assign o_gpio_we      = w_gpio_sel & i_core_we;
    assign o_gpio_oe      = w_gpio_sel & i_core_oe;

    assign o_uart_address = {i_core_address[31:2], 2'b00};
    assign o_uart_we      = w_uart_sel & i_core_we;
    assign o_uart_oe      = w_uart_sel & i_core_oe;
 
    always @(*) begin
        // Defaults prevent latches
        o_imem_address = {i_core_address[31:2], 2'b00};
        o_imem_oe      = 1'b0;
 
        o_dmem_address = {i_core_address[31:2], 2'b00};
        o_dmem_we      = 1'b0;
        o_dmem_oe      = 1'b0;
        o_dmem_bw      = 4'b0000;
 
        o_core_data    = 32'd0;
 
        if ((i_core_address & IMEM_MASK) == IMEM_BASE) begin
            // IMEM: read only. we and bw are never routed here.
            o_imem_oe   = i_core_oe;
            o_core_data = i_imem_data;
        end
        else if ((i_core_address & DMEM_MASK) == DMEM_BASE) begin
            o_dmem_oe   = i_core_oe;
            o_dmem_we   = i_core_we;
            o_dmem_bw   = i_core_bw;
            o_core_data = i_dmem_data;
        end
        else if (w_gpio_sel) begin
            o_core_data = i_gpio_data;
        end
        else if (w_uart_sel) begin
            o_core_data = i_uart_data;
        end
    end
endmodule



//  ---------- INLCUDED BLOCK: DMEM  ---------- 
module DMEM (
    input  wire        i_Clk,
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [3:0]  i_Bw,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data
);
    localparam DEPTH_W = 2048;        // 2048 words = 8 kB
    localparam IDX_HI  = 12;          // log2(8192) - 1
 
    reg [31:0] r_Ram [0:DEPTH_W-1];
 
    wire [IDX_HI-2:0] w_Index = i_Address[IDX_HI:2];
 
    always @(posedge i_Clk) begin
        // synchronous read: capture before any write commits
        if (i_Oe) o_Data <= r_Ram[w_Index];
 
        // per-byte write
        if (i_We) begin
            if (i_Bw[0]) r_Ram[w_Index][7:0]   <= i_Data[7:0];
            if (i_Bw[1]) r_Ram[w_Index][15:8]  <= i_Data[15:8];
            if (i_Bw[2]) r_Ram[w_Index][23:16] <= i_Data[23:16];
            if (i_Bw[3]) r_Ram[w_Index][31:24] <= i_Data[31:24];
        end
    end
endmodule



//  ---------- INLCUDED BLOCK: Control_Unit  ---------- 
`timescale 1ns / 1ps
module Control_Unit (
    input  wire        i_Clk,
    input  wire        i_Rst,
    input  wire [31:0] i_Instruction,
    input  wire        i_Branch_Taken,

    output reg  [1:0]  o_State,
    output reg         o_IR_Write,
    output reg         o_PC_Write,
    output reg  [1:0]  o_PC_Src,
    output reg  [3:0]  o_ALU_Op,
    output reg         o_ALU_SrcA,
    output reg         o_ALU_SrcB,
    output reg  [3:0]  o_Mul_Op,
    output reg  [3:0]  o_CRC_Op,
    output reg  [2:0]  o_WB_Sel,
    output reg         o_RD_We,
    output reg         o_Mem_We,
    output reg         o_Mem_Oe,
    output reg         o_Addr_Src
);

    // ---- states ------------------------------------------------------
    localparam [1:0] S_FETCH     = 2'd0;
    localparam [1:0] S_DECODE    = 2'd1;
    localparam [1:0] S_EXECUTE   = 2'd2;
    localparam [1:0] S_WRITEBACK = 2'd3;

    // ---- opcodes -----------------------------------------------------
    localparam [6:0] OP_LUI    = 7'b0110111;
    localparam [6:0] OP_AUIPC  = 7'b0010111;
    localparam [6:0] OP_JAL    = 7'b1101111;
    localparam [6:0] OP_JALR   = 7'b1100111;
    localparam [6:0] OP_BRANCH = 7'b1100011;
    localparam [6:0] OP_LOAD   = 7'b0000011;
    localparam [6:0] OP_STORE  = 7'b0100011;
    localparam [6:0] OP_IMM    = 7'b0010011;
    localparam [6:0] OP_REG    = 7'b0110011;
    localparam [6:0] OP_FENCE  = 7'b0001111;
    localparam [6:0] OP_SYSTEM = 7'b1110011;

    // ---- ALU selects (Table 9) ---------------------------------------
    localparam [3:0] ALU_PASS_B = 4'h0, ALU_ADD = 4'h1, ALU_SUB  = 4'h2,
                     ALU_AND    = 4'h3, ALU_OR  = 4'h4, ALU_XOR  = 4'h5,
                     ALU_SLL    = 4'h6, ALU_SRL = 4'h7, ALU_MRS  = 4'h8,
                     ALU_SLT    = 4'h9, ALU_SLTU = 4'hA;

    wire [6:0] w_Opcode = i_Instruction[6:0];
    wire [2:0] w_Funct3 = i_Instruction[14:12];
    wire [6:0] w_Funct7 = i_Instruction[31:25];

    wire w_Is_Alt   = (w_Funct7 == 7'b0100000);   // SUB / SRA
    wire w_Is_Mul   = (w_Opcode == OP_REG) && (w_Funct7 == 7'b0000001);
    wire w_Is_Crc   = (w_Opcode == OP_REG) && (w_Funct7 == 7'b1000000);
    wire w_Is_AluR  = (w_Opcode == OP_REG) && !w_Is_Mul && !w_Is_Crc;

    // ---- ALU operation decode ----------------------------------------
    reg [3:0] r_Alu_From_Funct3;
    always @(*) begin
        case (w_Funct3)
            3'b000 : r_Alu_From_Funct3 = (w_Is_AluR && w_Is_Alt) ? ALU_SUB : ALU_ADD;
            3'b001 : r_Alu_From_Funct3 = ALU_SLL;
            3'b010 : r_Alu_From_Funct3 = ALU_SLT;
            3'b011 : r_Alu_From_Funct3 = ALU_SLTU;
            3'b100 : r_Alu_From_Funct3 = ALU_XOR;
            3'b101 : r_Alu_From_Funct3 = w_Is_Alt ? ALU_MRS : ALU_SRL;
            3'b110 : r_Alu_From_Funct3 = ALU_OR;
            3'b111 : r_Alu_From_Funct3 = ALU_AND;
        endcase
    end

    // ---- state register ----------------------------------------------
    always @(posedge i_Clk) begin
        if (i_Rst) o_State <= S_FETCH;
        else begin
            case (o_State)
                S_FETCH     : o_State <= S_DECODE;
                S_DECODE    : o_State <= S_EXECUTE;
                S_EXECUTE   : o_State <= S_WRITEBACK;
                S_WRITEBACK : o_State <= S_FETCH;
            endcase
        end
    end

    // ---- control word --------------------------------------------------
    always @(*) begin
        // safe defaults
        o_IR_Write = 1'b0;
        o_PC_Write = 1'b0;
        o_PC_Src   = 2'd0;
        o_ALU_Op   = ALU_ADD;
        o_ALU_SrcA = 1'b0;
        o_ALU_SrcB = 1'b0;
        o_Mul_Op   = 4'h0;
        o_CRC_Op   = 4'h0;
        o_WB_Sel   = 3'd0;
        o_RD_We    = 1'b0;
        o_Mem_We   = 1'b0;
        o_Mem_Oe   = 1'b0;
        o_Addr_Src = 1'b0;      // PC

        case (o_State)

        // ------------------------------------------------------------
        S_FETCH: begin
            o_Addr_Src = 1'b0;          // address = PC
            o_Mem_Oe   = 1'b1;          // read IMEM
            o_IR_Write = 1'b1;          // capture instruction at end of cycle
        end

        // ------------------------------------------------------------
        S_DECODE: begin
            // register file reads are asynchronous; immediate generator
            // is combinational. Nothing to drive.
        end

        // ------------------------------------------------------------
        S_EXECUTE: begin
            case (w_Opcode)
                OP_REG: begin
                    o_ALU_SrcA = 1'b0;  // rs1
                    o_ALU_SrcB = 1'b0;  // rs2
                    o_ALU_Op   = r_Alu_From_Funct3;
                    o_Mul_Op   = {2'b00, w_Funct3[1:0]};
                    o_CRC_Op   = {2'b00, w_Funct3[1:0]};
                end
                OP_IMM: begin
                    o_ALU_SrcA = 1'b0;  // rs1
                    o_ALU_SrcB = 1'b1;  // immediate
                    o_ALU_Op   = r_Alu_From_Funct3;
                end
                OP_LOAD: begin
                    o_ALU_SrcA = 1'b0;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;     // rs1 + imm
                    o_Addr_Src = 1'b1;        // address = ALU result
                    o_Mem_Oe   = 1'b1;        // DMEM captures on this edge
                end
                OP_STORE: begin
                    o_ALU_SrcA = 1'b0;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_Addr_Src = 1'b1;
                    o_Mem_We   = 1'b1;        // write commits on this edge
                end
                OP_BRANCH: begin
                    o_ALU_SrcA = 1'b1;        // PC
                    o_ALU_SrcB = 1'b1;        // immediate
                    o_ALU_Op   = ALU_ADD;     // branch target = PC + imm
                end
                OP_JAL: begin
                    o_ALU_SrcA = 1'b1;        // PC
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                end
                OP_JALR: begin
                    o_ALU_SrcA = 1'b0;        // rs1
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                end
                OP_LUI: begin
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_PASS_B;  // Q = immediate
                end
                OP_AUIPC: begin
                    o_ALU_SrcA = 1'b1;        // PC
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                end
                default: begin                // FENCE, SYSTEM: no side effect
                    o_ALU_Op = ALU_ADD;
                end
            endcase
        end

        // ------------------------------------------------------------
        S_WRITEBACK: begin
            o_PC_Write = 1'b1;                // every instruction advances PC

            case (w_Opcode)
                OP_REG: begin
                    o_RD_We  = 1'b1;
                    o_WB_Sel = w_Is_Mul ? 3'd2 : (w_Is_Crc ? 3'd3 : 3'd0);
                    o_Mul_Op = {2'b00, w_Funct3[1:0]};
                    o_CRC_Op = {2'b00, w_Funct3[1:0]};
                    o_ALU_Op = r_Alu_From_Funct3;
                    o_ALU_SrcB = 1'b0;
                end
                OP_IMM: begin
                    o_RD_We  = 1'b1;
                    o_WB_Sel = 3'd0;
                    o_ALU_Op = r_Alu_From_Funct3;
                    o_ALU_SrcB = 1'b1;
                end
                OP_LOAD: begin
                    o_RD_We    = 1'b1;
                    o_WB_Sel   = 3'd1;        // LSU formatted data
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_Addr_Src = 1'b1;        // hold the address for the LSU
                    o_Mem_Oe   = 1'b1;        // keep oe asserted while consuming
                end
                OP_STORE: begin
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                end
                OP_BRANCH: begin
                    o_ALU_SrcA = 1'b1;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_PC_Src   = i_Branch_Taken ? 2'd1 : 2'd0;
                end
                OP_JAL: begin
                    o_ALU_SrcA = 1'b1;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_RD_We    = 1'b1;
                    o_WB_Sel   = 3'd4;        // rd = PC + 4
                    o_PC_Src   = 2'd1;
                end
                OP_JALR: begin
                    o_ALU_SrcA = 1'b0;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_RD_We    = 1'b1;
                    o_WB_Sel   = 3'd4;        // rd = PC + 4
                    o_PC_Src   = 2'd2;        // target with bit 0 cleared
                end
                OP_LUI: begin
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_PASS_B;
                    o_RD_We    = 1'b1;
                    o_WB_Sel   = 3'd0;
                end
                OP_AUIPC: begin
                    o_ALU_SrcA = 1'b1;
                    o_ALU_SrcB = 1'b1;
                    o_ALU_Op   = ALU_ADD;
                    o_RD_We    = 1'b1;
                    o_WB_Sel   = 3'd0;
                end
                default: begin                // FENCE, ECALL, EBREAK: NOP
                    o_RD_We = 1'b0;
                end
            endcase
        end

        endcase
    end

endmodule



//  ---------- INLCUDED BLOCK: PC_Unit  ---------- 
module PC_Unit (
    input  wire        i_Clk,
    input  wire        i_Rst,
    input  wire        i_PC_Write,
    input  wire [1:0]  i_PC_Src,
    input  wire [31:0] i_ALU_Result,
 
    output wire [31:0] o_PC,
    output wire [31:0] o_PC_Plus4
);
 
    localparam [31:0] c_RESET_VECTOR = 32'h0040_0000;   // IMEM base, Table 13
 
    reg  [31:0] r_PC;
    reg  [31:0] r_Next_PC;
 
    assign o_PC       = r_PC;
    assign o_PC_Plus4 = r_PC + 32'd4;
 
    always @(*) begin
        case (i_PC_Src)
            2'd0    : r_Next_PC = r_PC + 32'd4;
            2'd1    : r_Next_PC = i_ALU_Result;
            2'd2    : r_Next_PC = {i_ALU_Result[31:1], 1'b0};
            default : r_Next_PC = r_PC + 32'd4;
        endcase
    end
 
    always @(posedge i_Clk) begin
        if (i_Rst)           r_PC <= c_RESET_VECTOR;
        else if (i_PC_Write) r_PC <= r_Next_PC;
    end
 
endmodule



//  ---------- INLCUDED BLOCK: Datapath_Mux  ---------- 
module Datapath_Mux (
    input  wire        i_Clk,
    input  wire        i_Rst,
 
    // instruction register
    input  wire        i_IR_Write,
    input  wire [31:0] i_Instruction_In,
    output wire [31:0] o_IR,
 
    // operand sources
    input  wire [31:0] i_PC,
    input  wire [31:0] i_PC_Plus4,
    input  wire [31:0] i_RS1,
    input  wire [31:0] i_RS2,
    input  wire [31:0] i_Immediate,
    input  wire [31:0] i_ALU_Result,
    input  wire [31:0] i_LSU_Data,
    input  wire [31:0] i_Mul_Result,
    input  wire [31:0] i_CRC_Result,
 
    // selects from the Control Unit
    input  wire        i_ALU_SrcA,
    input  wire        i_ALU_SrcB,
    input  wire        i_Addr_Src,
    input  wire [2:0]  i_WB_Sel,
 
    // outputs
    output wire [31:0] o_ALU_A,
    output wire [31:0] o_ALU_B,
    output wire [31:0] o_Address,
  	output reg  [31:0] o_WB_Data,
    output wire [4:0]  o_RS1_Addr,
    output wire [4:0]  o_RS2_Addr,
    output wire [4:0]  o_RD_Addr,
    output wire [2:0]  o_Funct3
);
 
    // ---- instruction register ----------------------------------------
    reg [31:0] r_IR;
    assign o_IR = r_IR;
  
  	assign o_RS1_Addr = r_IR[19:15];
    assign o_RS2_Addr = r_IR[24:20];
    assign o_RD_Addr  = r_IR[11:7];
    assign o_Funct3   = r_IR[14:12];
 
    always @(posedge i_Clk) begin
        if (i_Rst)           r_IR <= 32'h0000_0013;   // addi x0,x0,0 = nop
        else if (i_IR_Write) r_IR <= i_Instruction_In;
    end
 
    // ---- operand muxes -------------------------------------------------
    assign o_ALU_A   = i_ALU_SrcA ? i_PC          : i_RS1;
    assign o_ALU_B   = i_ALU_SrcB ? i_Immediate   : i_RS2;
    assign o_Address = i_Addr_Src ? i_ALU_Result  : i_PC;
 
    // ---- write-back mux --------------------------------------------------
    always @(*) begin
        case (i_WB_Sel)
            3'd0    : o_WB_Data = i_ALU_Result;
            3'd1    : o_WB_Data = i_LSU_Data;
            3'd2    : o_WB_Data = i_Mul_Result;
            3'd3    : o_WB_Data = i_CRC_Result;
            3'd4    : o_WB_Data = i_PC_Plus4;
            default : o_WB_Data = 32'h0000_0000;
        endcase
    end
 
endmodule



//  ---------- INLCUDED BLOCK: GPIO  ---------- 
module GPIO (
    input  wire        i_Clk,
    input  wire        i_Rst,

    // bus side (from Address_Decoder)
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data,

    // pin side: split tristate, collapsed to inout pins_io at the top level
    output wire [7:0]  o_Pins_Out,
    output wire [7:0]  o_Pins_Oe,
    input  wire [7:0]  i_Pins_In
);
    // Word offsets (Block Guide Stage 3, Table 1)
    localparam [9:0] c_DATAOUT = 10'd0,   // 0x0000
                     c_DATAIN  = 10'd1,   // 0x0004
                     c_DATADIR = 10'd2;   // 0x0008

    reg [7:0] r_DataOut;
    reg [7:0] r_DataIn;
    reg [7:0] r_DataDir;
    reg [7:0] r_Sync1;
    reg [7:0] r_Sync2;

    // The two lower address bits are ignored; any other offset is reserved.
    wire [9:0] w_Word = i_Address[11:2];

    assign o_Pins_Out = r_DataOut;
    assign o_Pins_Oe  = r_DataDir;

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_DataOut <= 8'd0;
            r_DataDir <= 8'd0;      // all inputs: nothing driven out of reset
            r_DataIn  <= 8'd0;
            r_Sync1   <= 8'd0;
            r_Sync2   <= 8'd0;
        end else begin
            // Pins are asynchronous to i_Clk, so synchronize before sampling.
            r_Sync1 <= i_Pins_In;
            r_Sync2 <= r_Sync1;
            // Guide §1.3.1: in output mode the input buffer is isolated, so a
            // pin's DATAIN bit holds instead of sampling its own driven value.
            r_DataIn <= (r_DataIn & r_DataDir) | (r_Sync2 & ~r_DataDir);

            if (i_We) begin
                case (w_Word)
                    c_DATAOUT: r_DataOut <= i_Data[7:0];
                    c_DATADIR: r_DataDir <= i_Data[7:0];
                    default: ;  // DATAIN is read-only; reserved offsets ignored
                endcase
            end
        end
    end

    always @(*) begin
        o_Data = 32'd0;
        if (i_Oe) begin
            case (w_Word)
                c_DATAOUT: o_Data = {24'd0, r_DataOut};
                c_DATAIN:  o_Data = {24'd0, r_DataIn};
                c_DATADIR: o_Data = {24'd0, r_DataDir};
                default:   o_Data = 32'd0;
            endcase
        end
    end
endmodule



//  ---------- INLCUDED BLOCK: UART  ---------- 
module UART #(
    parameter integer CLK_HZ = 25_000_000,
    parameter integer BAUD   = 115_200,
    // 0 (spec): only setting CONTROL.TRANSMIT starts a transmission; writing
    // TXDATA just loads the byte (guide 2.2.1). The kickoff lecture states it
    // as a project rule ("some processors transmit automatically when you
    // write this field -- we're not going to do this"), and the organizer's
    // uart.s sets TRANSMIT after writing TXDATA; the printed 2.3.3 echo omits
    // that step. 1 = also start on a TXDATA write (non-spec, experiments only).
    parameter         TX_ON_TXDATA_WRITE = 0
) (
    input  wire        i_Clk,
    input  wire        i_Rst,

    // bus side (from Address_Decoder)
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data,

    // serial side, 8-N-1
    output wire        o_Tx,
    input  wire        i_Rx
);
    localparam integer DIVISOR = CLK_HZ / BAUD;   // clocks per bit
    localparam integer HALF    = DIVISOR / 2;

    // Word offsets (Block Guide Stage 3, Table 5)
    localparam [9:0] c_TXDATA  = 10'd0,   // 0x0000
                     c_RXDATA  = 10'd1,   // 0x0004
                     c_CONTROL = 10'd2;   // 0x0008

    localparam [2:0] S_IDLE  = 3'd0,
                     S_START = 3'd1,
                     S_DATA  = 3'd2,
                     S_STOP  = 3'd3,
                     S_WAIT  = 3'd4;

    // The two lower address bits are ignored; any other offset is reserved.
    wire [9:0] w_Word      = i_Address[11:2];
    wire       w_WrTxData  = i_We && (w_Word == c_TXDATA);
    wire       w_WrControl = i_We && (w_Word == c_CONTROL);

    // ------------------------------------------------------------------
    // Transmitter
    // ------------------------------------------------------------------
    reg [7:0]  r_TxData;
    reg        r_Transmit;        // CONTROL[0]
    reg        r_TxDataWr;        // TXDATA was written last cycle
    reg        r_TxDone;          // CONTROL[2]
    reg        r_TxBusy;
    reg [9:0]  r_TxFrame;         // {stop, data, start}, shifted out LSB first
    reg [3:0]  r_TxBitsLeft;
    reg [15:0] r_TxCnt;

    wire w_TxStart = !r_TxBusy &&
                     (r_Transmit || (TX_ON_TXDATA_WRITE != 0 && r_TxDataWr));

    assign o_Tx = r_TxBusy ? r_TxFrame[0] : 1'b1;   // line idles high

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_TxData     <= 8'd0;
            r_Transmit   <= 1'b0;
            r_TxDataWr   <= 1'b0;
            // Idle means ready: the §2.3.3 echo polls TXDONE before its first
            // send, so reading 0 out of reset would deadlock it.
            r_TxDone     <= 1'b1;
            r_TxBusy     <= 1'b0;
            r_TxFrame    <= 10'h3FF;
            r_TxBitsLeft <= 4'd0;
            r_TxCnt      <= 16'd0;
        end else begin
            // TRANSMIT self-clears in the cycle after the write (Table 8, note 2).
            r_Transmit <= w_WrControl & i_Data[0];
            r_TxDataWr <= w_WrTxData;
            if (w_WrTxData) r_TxData <= i_Data[7:0];

            if (w_TxStart) begin
                r_TxBusy     <= 1'b1;
                r_TxDone     <= 1'b0;
                r_TxFrame    <= {1'b1, r_TxData, 1'b0};
                r_TxBitsLeft <= 4'd9;
                r_TxCnt      <= DIVISOR - 1;
            end else if (r_TxBusy) begin
                if (r_TxCnt != 0) begin
                    r_TxCnt <= r_TxCnt - 1;
                end else begin
                    r_TxCnt   <= DIVISOR - 1;
                    r_TxFrame <= {1'b1, r_TxFrame[9:1]};
                    if (r_TxBitsLeft == 0) begin
                        r_TxBusy <= 1'b0;
                        r_TxDone <= 1'b1;
                    end else begin
                        r_TxBitsLeft <= r_TxBitsLeft - 1;
                    end
                end
            end
        end
    end

    // ------------------------------------------------------------------
    // Receiver
    // ------------------------------------------------------------------
    reg        r_RxSync1;
    reg        r_RxSync2;
    reg [2:0]  r_RxState;
    reg [15:0] r_RxCnt;
    reg [2:0]  r_RxBit;
    reg [7:0]  r_RxShift;
    reg [7:0]  r_RxData;
    reg        r_RxDone;          // CONTROL[1]

    // A frame is accepted only if its stop bit, sampled mid-bit, is high.
    wire w_RxComplete = (r_RxState == S_STOP) && (r_RxCnt == 0) && r_RxSync2;

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_RxSync1 <= 1'b1;
            r_RxSync2 <= 1'b1;
            r_RxState <= S_IDLE;
            r_RxCnt   <= 16'd0;
            r_RxBit   <= 3'd0;
            r_RxShift <= 8'd0;
            r_RxData  <= 8'd0;
            r_RxDone  <= 1'b0;
        end else begin
            // rx_i is asynchronous to i_Clk, so synchronize before use.
            r_RxSync1 <= i_Rx;
            r_RxSync2 <= r_RxSync1;

            // No oversampling, so each bit is sampled once at its centre:
            // half a bit after the start edge to confirm the start bit, then
            // one full bit period per data bit and for the stop bit.
            case (r_RxState)
                S_IDLE: begin
                    if (!r_RxSync2) begin
                        r_RxState <= S_START;
                        r_RxCnt   <= HALF - 1;
                    end
                end
                S_START: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else if (r_RxSync2) begin
                        r_RxState <= S_IDLE;           // glitch, not a start bit
                    end else begin
                        r_RxState <= S_DATA;
                        r_RxCnt   <= DIVISOR - 1;
                        r_RxBit   <= 3'd0;
                    end
                end
                S_DATA: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else begin
                        r_RxShift <= {r_RxSync2, r_RxShift[7:1]};   // LSB first
                        r_RxCnt   <= DIVISOR - 1;
                        if (r_RxBit == 3'd7) r_RxState <= S_STOP;
                        else                 r_RxBit   <= r_RxBit + 1;
                    end
                end
                S_STOP: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else if (r_RxSync2) begin
                        r_RxData  <= r_RxShift;
                        r_RxState <= S_IDLE;
                    end else begin
                        // Framing error: drop the byte and wait for the line to
                        // go idle, or the low stop bit would read as a new start.
                        r_RxState <= S_WAIT;
                    end
                end
                S_WAIT: begin
                    if (r_RxSync2) r_RxState <= S_IDLE;
                end
                default: r_RxState <= S_IDLE;
            endcase

            // RXDONE: set by the receiver, cleared by software writing 0.
            // A byte completing in the same cycle wins, so it is never lost.
            if (w_RxComplete)     r_RxDone <= 1'b1;
            else if (w_WrControl) r_RxDone <= i_Data[1];
        end
    end

    // ------------------------------------------------------------------
    // Register reads
    // ------------------------------------------------------------------
    always @(*) begin
        o_Data = 32'd0;
        if (i_Oe) begin
            case (w_Word)
                c_TXDATA:  o_Data = {24'd0, r_TxData};
                c_RXDATA:  o_Data = {24'd0, r_RxData};
                c_CONTROL: o_Data = {29'd0, r_TxDone, r_RxDone, r_Transmit};
                default:   o_Data = 32'd0;
            endcase
        end
    end
endmodule



//  ---------- INLCUDED BLOCK: IMEM_Data_Center  ---------- 
module IMEM_Data_Center (
    input  wire [31:0] i_Address,
    input  wire        i_Oe,          // routed per 4.4; unused internally
    output wire [31:0] o_Data
);
    // GENERATED by sim/rv32_asm.py from dc_teammate.s -- edit the .s, not this.
    // Same instructions as the organizer's Makefile (build/firmware.txt).
    reg [31:0] r_Instruction;
    assign o_Data = r_Instruction;

    always @(*) begin
        case (i_Address)
            32'h00400000: r_Instruction = 32'hF0000437;   // la   s0, GPIO_BASE
            32'h00400004: r_Instruction = 32'hF10004B7;   // la   s1, UART_BASE
            32'h00400008: r_Instruction = 32'h10010DB7;   // li   s11, DMEM_BASE
            32'h0040000C: r_Instruction = 32'h00842283;   // lw   t0, GPIO_DATADIR(s0)
            32'h00400010: r_Instruction = 32'h0F02E293;   // ori  t0, t0, 0xF0
            32'h00400014: r_Instruction = 32'h00542423;   // sw   t0, GPIO_DATADIR(s0)
            32'h00400018: r_Instruction = 32'h00042023;   // sw   zero, GPIO_DATAOUT(s0)
            32'h0040001C: r_Instruction = 32'h000D8293;   // mv   t0, s11
            32'h00400020: r_Instruction = 32'h01600313;   // li   t1, ST_WORDS
            32'h00400024: r_Instruction = 32'h0002A023;   // sw   zero, 0(t0)
            32'h00400028: r_Instruction = 32'h00428293;   // addi t0, t0, 4
            32'h0040002C: r_Instruction = 32'hFFF30313;   // addi t1, t1, -1
            32'h00400030: r_Instruction = 32'hFE031AE3;   // bnez t1, _boot_clear
            32'h00400034: r_Instruction = 32'h10E00293;   // li   t0, DEF_WARM
            32'h00400038: r_Instruction = 32'h005DA023;   // sw   t0, ST_THR_WARM(s11)
            32'h0040003C: r_Instruction = 32'h14000293;   // li   t0, DEF_CRIT
            32'h00400040: r_Instruction = 32'h005DA223;   // sw   t0, ST_THR_CRIT(s11)
            32'h00400044: r_Instruction = 32'h0E600293;   // li   t0, DEF_VOLTAGE
            32'h00400048: r_Instruction = 32'h005DA423;   // sw   t0, ST_VOLTAGE(s11)
            32'h0040004C: r_Instruction = 32'h08000293;   // li   t0, DEF_WARN_CURRENT
            32'h00400050: r_Instruction = 32'h005DA623;   // sw   t0, ST_WARN_CURRENT(s11)
            32'h00400054: r_Instruction = 32'h0A000293;   // li   t0, DEF_TRIP_CURRENT
            32'h00400058: r_Instruction = 32'h005DA823;   // sw   t0, ST_TRIP_CURRENT(s11)
            32'h0040005C: r_Instruction = 32'h2F4000EF;   // jal  ra, rx_byte_wait
            32'h00400060: r_Instruction = 32'h00050913;   // mv   s2, a0
            32'h00400064: r_Instruction = 32'h05A00293;   // li   t0, CMD_SAMPLE
            32'h00400068: r_Instruction = 32'h06590E63;   // beq  s2, t0, cmd_sample_receive
            32'h0040006C: r_Instruction = 32'h354000EF;   // jal  ra, rx_byte_timeout
            32'h00400070: r_Instruction = 32'hFE0586E3;   // beqz a1, main_loop
            32'h00400074: r_Instruction = 32'h00050993;   // mv   s3, a0
            32'h00400078: r_Instruction = 32'h348000EF;   // jal  ra, rx_byte_timeout
            32'h0040007C: r_Instruction = 32'hFE0580E3;   // beqz a1, main_loop
            32'h00400080: r_Instruction = 32'h00050A13;   // mv   s4, a0
            32'h00400084: r_Instruction = 32'h33C000EF;   // jal  ra, rx_byte_timeout
            32'h00400088: r_Instruction = 32'hFC058AE3;   // beqz a1, main_loop
            32'h0040008C: r_Instruction = 32'h00851513;   // slli a0, a0, 8
            32'h00400090: r_Instruction = 32'h00AA6A33;   // or   s4, s4, a0
            32'h00400094: r_Instruction = 32'h000102B7;   // li   t0, 0xFFFF
            32'h00400098: r_Instruction = 32'hFFF28293;   //   (cont. of: li   t0, 0xFFFF)
            32'h0040009C: r_Instruction = 32'h805902B3;   // crcb t0, s2, t0
            32'h004000A0: r_Instruction = 32'h805982B3;   // crcb t0, s3, t0
            32'h004000A4: r_Instruction = 32'h0B429C63;   // bne  t0, s4, cmd_badcrc
            32'h004000A8: r_Instruction = 32'h04000293;   // li   t0, CMD_STAGE_HIGH
            32'h004000AC: r_Instruction = 32'h18590263;   // beq  s2, t0, cmd_stage
            32'h004000B0: r_Instruction = 32'h04100293;   // li   t0, CMD_SET_WARM
            32'h004000B4: r_Instruction = 32'h18590863;   // beq  s2, t0, cmd_set_warm
            32'h004000B8: r_Instruction = 32'h04300293;   // li   t0, CMD_SET_CRIT
            32'h004000BC: r_Instruction = 32'h18590863;   // beq  s2, t0, cmd_set_crit
            32'h004000C0: r_Instruction = 32'h04600293;   // li   t0, CMD_SET_WARN_CURRENT
            32'h004000C4: r_Instruction = 32'h24590663;   // beq  s2, t0, cmd_set_warn_current
            32'h004000C8: r_Instruction = 32'h04800293;   // li   t0, CMD_SET_TRIP_CURRENT
            32'h004000CC: r_Instruction = 32'h26590663;   // beq  s2, t0, cmd_set_trip_current
            32'h004000D0: r_Instruction = 32'h05000293;   // li   t0, CMD_STATUS
            32'h004000D4: r_Instruction = 32'h1A590E63;   // beq  s2, t0, cmd_status
            32'h004000D8: r_Instruction = 32'h05200293;   // li   t0, CMD_COUNTERS
            32'h004000DC: r_Instruction = 32'h20590663;   // beq  s2, t0, cmd_counters
            32'h004000E0: r_Instruction = 32'h0700006F;   // j    reply_invalid
            32'h004000E4: r_Instruction = 32'h2DC000EF;   // jal  ra, rx_byte_timeout
            32'h004000E8: r_Instruction = 32'hF6058AE3;   // beqz a1, main_loop
            32'h004000EC: r_Instruction = 32'h00050993;   // mv   s3, a0
            32'h004000F0: r_Instruction = 32'h2D0000EF;   // jal  ra, rx_byte_timeout
            32'h004000F4: r_Instruction = 32'hF60584E3;   // beqz a1, main_loop
            32'h004000F8: r_Instruction = 32'h00050A13;   // mv   s4, a0
            32'h004000FC: r_Instruction = 32'h2C4000EF;   // jal  ra, rx_byte_timeout
            32'h00400100: r_Instruction = 32'hF4058EE3;   // beqz a1, main_loop
            32'h00400104: r_Instruction = 32'h00050A93;   // mv   s5, a0
            32'h00400108: r_Instruction = 32'h2B8000EF;   // jal  ra, rx_byte_timeout
            32'h0040010C: r_Instruction = 32'hF40588E3;   // beqz a1, main_loop
            32'h00400110: r_Instruction = 32'h00050F13;   // mv   t5, a0
            32'h00400114: r_Instruction = 32'h2AC000EF;   // jal  ra, rx_byte_timeout
            32'h00400118: r_Instruction = 32'hF40582E3;   // beqz a1, main_loop
            32'h0040011C: r_Instruction = 32'h00851513;   // slli a0, a0, 8
            32'h00400120: r_Instruction = 32'h00AF6F33;   // or   t5, t5, a0
            32'h00400124: r_Instruction = 32'h000102B7;   // li   t0, 0xFFFF
            32'h00400128: r_Instruction = 32'hFFF28293;   //   (cont. of: li   t0, 0xFFFF)
            32'h0040012C: r_Instruction = 32'h805902B3;   // crcb t0, s2, t0
            32'h00400130: r_Instruction = 32'h805982B3;   // crcb t0, s3, t0
            32'h00400134: r_Instruction = 32'h805A02B3;   // crcb t0, s4, t0
            32'h00400138: r_Instruction = 32'h805A82B3;   // crcb t0, s5, t0
            32'h0040013C: r_Instruction = 32'h03E29063;   // bne  t0, t5, cmd_badcrc
            32'h00400140: r_Instruction = 32'h03C0006F;   // j    cmd_sample_process
            32'h00400144: r_Instruction = 32'h0A500513;   // li   a0, REPLY_OK
            32'h00400148: r_Instruction = 32'h2A8000EF;   // jal  ra, tx_byte
            32'h0040014C: r_Instruction = 32'hF11FF06F;   // j    main_loop
            32'h00400150: r_Instruction = 32'h03C00513;   // li   a0, REPLY_INVALID
            32'h00400154: r_Instruction = 32'h29C000EF;   // jal  ra, tx_byte
            32'h00400158: r_Instruction = 32'hF05FF06F;   // j    main_loop
            32'h0040015C: r_Instruction = 32'h03CDA283;   // lw   t0, ST_CRC_REJECTS(s11)
            32'h00400160: r_Instruction = 32'h0FF00313;   // li   t1, 255
            32'h00400164: r_Instruction = 32'h0062F663;   // bgeu t0, t1, _badcrc_reply
            32'h00400168: r_Instruction = 32'h00128293;   // addi t0, t0, 1
            32'h0040016C: r_Instruction = 32'h025DAE23;   // sw   t0, ST_CRC_REJECTS(s11)
            32'h00400170: r_Instruction = 32'h05A00513;   // li   a0, REPLY_BADCRC
            32'h00400174: r_Instruction = 32'h27C000EF;   // jal  ra, tx_byte
            32'h00400178: r_Instruction = 32'hEE5FF06F;   // j    main_loop
            32'h0040017C: r_Instruction = 32'h0B400293;   // li   t0, 180
            32'h00400180: r_Instruction = 32'hFC59E8E3;   // bltu s3, t0, reply_invalid
            32'h00400184: r_Instruction = 32'h0FF00293;   // li   t0, 255
            32'h00400188: r_Instruction = 32'hFC5984E3;   // beq  s3, t0, reply_invalid
            32'h0040018C: r_Instruction = 32'hFC5A02E3;   // beq  s4, t0, reply_invalid
            32'h00400190: r_Instruction = 32'hFC0A80E3;   // beqz s5, reply_invalid
            32'h00400194: r_Instruction = 32'hFA5A8EE3;   // beq  s5, t0, reply_invalid
            32'h00400198: r_Instruction = 32'h013DA423;   // sw   s3, ST_VOLTAGE(s11)
            32'h0040019C: r_Instruction = 32'h054DA023;   // sw   s4, ST_LATEST_CURRENT(s11)
            32'h004001A0: r_Instruction = 32'h00100293;   // li   t0, 1
            32'h004001A4: r_Instruction = 32'h045DA823;   // sw   t0, ST_GOT_CURRENT(s11)
            32'h004001A8: r_Instruction = 32'h00CDA283;   // lw   t0, ST_WARN_CURRENT(s11)
            32'h004001AC: r_Instruction = 32'h005A3333;   // sltu t1, s4, t0
            32'h004001B0: r_Instruction = 32'h00134313;   // xori t1, t1, 1
            32'h004001B4: r_Instruction = 32'h046DA223;   // sw   t1, ST_OVERLOAD(s11)
            32'h004001B8: r_Instruction = 32'h00500293;   // li   t0, 5
            32'h004001BC: r_Instruction = 32'h025A8333;   // mul  t1, s5, t0
            32'h004001C0: r_Instruction = 32'h00000393;   // li   t2, 0
            32'h004001C4: r_Instruction = 32'h000DA283;   // lw   t0, ST_THR_WARM(s11)
            32'h004001C8: r_Instruction = 32'h00534A63;   // blt  t1, t0, _sm_class_done
            32'h004001CC: r_Instruction = 32'h00100393;   // li   t2, 1
            32'h004001D0: r_Instruction = 32'h004DA283;   // lw   t0, ST_THR_CRIT(s11)
            32'h004001D4: r_Instruction = 32'h0062D463;   // bge  t0, t1, _sm_class_done
            32'h004001D8: r_Instruction = 32'h00300393;   // li   t2, 3
            32'h004001DC: r_Instruction = 32'h027DA623;   // sw   t2, ST_CLASS(s11)
            32'h004001E0: r_Instruction = 32'h035DA423;   // sw   s5, ST_LATEST_TEMP(s11)
            32'h004001E4: r_Instruction = 32'h00100293;   // li   t0, 1
            32'h004001E8: r_Instruction = 32'h025DAC23;   // sw   t0, ST_GOT_TEMP(s11)
            32'h004001EC: r_Instruction = 32'h010DA283;   // lw   t0, ST_TRIP_CURRENT(s11)
            32'h004001F0: r_Instruction = 32'h0142EA63;   // bltu t0, s4, _sm_trip_epo
            32'h004001F4: r_Instruction = 32'h02CDA283;   // lw   t0, ST_CLASS(s11)
            32'h004001F8: r_Instruction = 32'h00300313;   // li   t1, 3
            32'h004001FC: r_Instruction = 32'h00628463;   // beq  t0, t1, _sm_trip_epo
            32'h00400200: r_Instruction = 32'h0280006F;   // j    _sm_update_outputs          # the EPO latches; only P0 clears it (check_reset)
            32'h00400204: r_Instruction = 32'h034DA283;   // lw   t0, ST_EPO(s11)
            32'h00400208: r_Instruction = 32'h02029063;   // bnez t0, _sm_update_outputs
            32'h0040020C: r_Instruction = 32'h00100293;   // li   t0, 1
            32'h00400210: r_Instruction = 32'h025DAA23;   // sw   t0, ST_EPO(s11)
            32'h00400214: r_Instruction = 32'h04CDA283;   // lw   t0, ST_EPO_TRIPS(s11)
            32'h00400218: r_Instruction = 32'h0FF00313;   // li   t1, 255
            32'h0040021C: r_Instruction = 32'h0062F663;   // bgeu t0, t1, _sm_update_outputs
            32'h00400220: r_Instruction = 32'h00128293;   // addi t0, t0, 1
            32'h00400224: r_Instruction = 32'h045DA623;   // sw   t0, ST_EPO_TRIPS(s11)
            32'h00400228: r_Instruction = 32'h1E8000EF;   // jal  ra, update_outputs
            32'h0040022C: r_Instruction = 32'hF19FF06F;   // j    reply_ok
            32'h00400230: r_Instruction = 32'h00899293;   // slli t0, s3, 8
            32'h00400234: r_Instruction = 32'h025DA023;   // sw   t0, ST_STAGE(s11)
            32'h00400238: r_Instruction = 32'h00100293;   // li   t0, 1
            32'h0040023C: r_Instruction = 32'h025DA223;   // sw   t0, ST_STAGE_PENDING(s11)
            32'h00400240: r_Instruction = 32'hF05FF06F;   // j    reply_ok
            32'h00400244: r_Instruction = 32'h00000A93;   // li   s5, ST_THR_WARM
            32'h00400248: r_Instruction = 32'h0080006F;   // j    set_threshold
            32'h0040024C: r_Instruction = 32'h00400A93;   // li   s5, ST_THR_CRIT
            32'h00400250: r_Instruction = 32'h024DA283;   // lw   t0, ST_STAGE_PENDING(s11)
            32'h00400254: r_Instruction = 32'h020DA223;   // sw   zero, ST_STAGE_PENDING(s11)
            32'h00400258: r_Instruction = 32'hEE028CE3;   // beqz t0, reply_invalid
            32'h0040025C: r_Instruction = 32'h020DA283;   // lw   t0, ST_STAGE(s11)
            32'h00400260: r_Instruction = 32'h0132E2B3;   // or   t0, t0, s3
            32'h00400264: r_Instruction = 32'h000DA303;   // lw   t1, ST_THR_WARM(s11)
            32'h00400268: r_Instruction = 32'h004DAE03;   // lw   t3, ST_THR_CRIT(s11)
            32'h0040026C: r_Instruction = 32'h00000E93;   // li   t4, ST_THR_WARM
            32'h00400270: r_Instruction = 32'h01DA9663;   // bne  s5, t4, _set_critical
            32'h00400274: r_Instruction = 32'h00028313;   // mv   t1, t0
            32'h00400278: r_Instruction = 32'h0080006F;   // j    _set_check
            32'h0040027C: r_Instruction = 32'h00028E13;   // mv   t3, t0
            32'h00400280: r_Instruction = 32'hEDC358E3;   // bge  t1, t3, reply_invalid
            32'h00400284: r_Instruction = 32'h015D8EB3;   // add  t4, s11, s5
            32'h00400288: r_Instruction = 32'h005EA023;   // sw   t0, 0(t4)
            32'h0040028C: r_Instruction = 32'hEB9FF06F;   // j    reply_ok
            32'h00400290: r_Instruction = 32'hEC0990E3;   // bnez s3, reply_invalid
            32'h00400294: r_Instruction = 32'h02CDA283;   // lw   t0, ST_CLASS(s11)
            32'h00400298: r_Instruction = 32'h044DA303;   // lw   t1, ST_OVERLOAD(s11)
            32'h0040029C: r_Instruction = 32'h00231313;   // slli t1, t1, 2
            32'h004002A0: r_Instruction = 32'h0062E2B3;   // or   t0, t0, t1
            32'h004002A4: r_Instruction = 32'h034DA303;   // lw   t1, ST_EPO(s11)
            32'h004002A8: r_Instruction = 32'h00331313;   // slli t1, t1, 3
            32'h004002AC: r_Instruction = 32'h0062E2B3;   // or   t0, t0, t1
            32'h004002B0: r_Instruction = 32'h038DA303;   // lw   t1, ST_GOT_TEMP(s11)
            32'h004002B4: r_Instruction = 32'h00631313;   // slli t1, t1, 6
            32'h004002B8: r_Instruction = 32'h0062E2B3;   // or   t0, t0, t1
            32'h004002BC: r_Instruction = 32'h024DA303;   // lw   t1, ST_STAGE_PENDING(s11)
            32'h004002C0: r_Instruction = 32'h00731313;   // slli t1, t1, 7
            32'h004002C4: r_Instruction = 32'h0062E533;   // or   a0, t0, t1
            32'h004002C8: r_Instruction = 32'h128000EF;   // jal  ra, tx_byte
            32'h004002CC: r_Instruction = 32'h028DA503;   // lw   a0, ST_LATEST_TEMP(s11)
            32'h004002D0: r_Instruction = 32'h120000EF;   // jal  ra, tx_byte
            32'h004002D4: r_Instruction = 32'h040DA503;   // lw   a0, ST_LATEST_CURRENT(s11)
            32'h004002D8: r_Instruction = 32'h118000EF;   // jal  ra, tx_byte
            32'h004002DC: r_Instruction = 32'h04CDA503;   // lw   a0, ST_EPO_TRIPS(s11)
            32'h004002E0: r_Instruction = 32'h110000EF;   // jal  ra, tx_byte
            32'h004002E4: r_Instruction = 32'hD79FF06F;   // j    main_loop
            32'h004002E8: r_Instruction = 32'hE60994E3;   // bnez s3, reply_invalid
            32'h004002EC: r_Instruction = 32'h03CDA503;   // lw   a0, ST_CRC_REJECTS(s11)
            32'h004002F0: r_Instruction = 32'h100000EF;   // jal  ra, tx_byte
            32'h004002F4: r_Instruction = 32'h00000513;   // li   a0, 0
            32'h004002F8: r_Instruction = 32'h0F8000EF;   // jal  ra, tx_byte
            32'h004002FC: r_Instruction = 32'h00000513;   // li   a0, 0
            32'h00400300: r_Instruction = 32'h0F0000EF;   // jal  ra, tx_byte
            32'h00400304: r_Instruction = 32'h00000513;   // li   a0, 0
            32'h00400308: r_Instruction = 32'h0E8000EF;   // jal  ra, tx_byte
            32'h0040030C: r_Instruction = 32'hD51FF06F;   // j    main_loop
            32'h00400310: r_Instruction = 32'hE40980E3;   // beqz s3, reply_invalid
            32'h00400314: r_Instruction = 32'h010DA283;   // lw   t0, ST_TRIP_CURRENT(s11)
            32'h00400318: r_Instruction = 32'hE259FCE3;   // bgeu s3, t0, reply_invalid
            32'h0040031C: r_Instruction = 32'h013DA623;   // sw   s3, ST_WARN_CURRENT(s11)
            32'h00400320: r_Instruction = 32'h040DA283;   // lw   t0, ST_LATEST_CURRENT(s11)
            32'h00400324: r_Instruction = 32'h0132B2B3;   // sltu t0, t0, s3
            32'h00400328: r_Instruction = 32'h0012C293;   // xori t0, t0, 1
            32'h0040032C: r_Instruction = 32'h045DA223;   // sw   t0, ST_OVERLOAD(s11)
            32'h00400330: r_Instruction = 32'h0E0000EF;   // jal  ra, update_outputs
            32'h00400334: r_Instruction = 32'hE11FF06F;   // j    reply_ok
            32'h00400338: r_Instruction = 32'h0FF00293;   // li   t0, 255
            32'h0040033C: r_Instruction = 32'hE0598AE3;   // beq  s3, t0, reply_invalid
            32'h00400340: r_Instruction = 32'h00CDA283;   // lw   t0, ST_WARN_CURRENT(s11)
            32'h00400344: r_Instruction = 32'hE132F6E3;   // bgeu t0, s3, reply_invalid
            32'h00400348: r_Instruction = 32'h013DA823;   // sw   s3, ST_TRIP_CURRENT(s11)
            32'h0040034C: r_Instruction = 32'hDF9FF06F;   // j    reply_ok
            32'h00400350: r_Instruction = 32'h00008D13;   // mv   s10, ra
            32'h00400354: r_Instruction = 32'h0084A283;   // lw   t0, UART_CONTROL(s1)
            32'h00400358: r_Instruction = 32'h0022F293;   // andi t0, t0, UART_RXDONE
            32'h0040035C: r_Instruction = 32'h00029663;   // bnez t0, _rxw_got
            32'h00400360: r_Instruction = 32'h018000EF;   // jal  ra, check_reset             # poll P0 while waiting for a packet
            32'h00400364: r_Instruction = 32'hFF1FF06F;   // j    _rxw_loop
            32'h00400368: r_Instruction = 32'h0004A423;   // sw   zero, UART_CONTROL(s1)
            32'h0040036C: r_Instruction = 32'h0044A503;   // lw   a0, UART_RXDATA(s1)
            32'h00400370: r_Instruction = 32'h000D0093;   // mv   ra, s10
            32'h00400374: r_Instruction = 32'h00008067;   // ret
            32'h00400378: r_Instruction = 32'h00008C93;   // mv   s9, ra
            32'h0040037C: r_Instruction = 32'h00442703;   // lw   a4, GPIO_DATAIN(s0)
            32'h00400380: r_Instruction = 32'h00177713;   // andi a4, a4, PIN_RESET
            32'h00400384: r_Instruction = 32'h054DA303;   // lw   t1, ST_BTN_PREV(s11)
            32'h00400388: r_Instruction = 32'h04EDAA23;   // sw   a4, ST_BTN_PREV(s11)
            32'h0040038C: r_Instruction = 32'h02070663;   // beqz a4, _cr_ret                 # not pressed
            32'h00400390: r_Instruction = 32'h02031463;   // bnez t1, _cr_ret                 # still held: not a new press
            32'h00400394: r_Instruction = 32'h034DA283;   // lw   t0, ST_EPO(s11)
            32'h00400398: r_Instruction = 32'h02028063;   // beqz t0, _cr_ret                 # nothing to reset
            32'h0040039C: r_Instruction = 32'h02CDA283;   // lw   t0, ST_CLASS(s11)
            32'h004003A0: r_Instruction = 32'h00029C63;   // bnez t0, _cr_ret                 # temperature not Normal
            32'h004003A4: r_Instruction = 32'h040DA283;   // lw   t0, ST_LATEST_CURRENT(s11)
            32'h004003A8: r_Instruction = 32'h00CDA303;   // lw   t1, ST_WARN_CURRENT(s11)
            32'h004003AC: r_Instruction = 32'h0062F663;   // bgeu t0, t1, _cr_ret             # current at or above the warning level
            32'h004003B0: r_Instruction = 32'h020DAA23;   // sw   zero, ST_EPO(s11)
            32'h004003B4: r_Instruction = 32'h05C000EF;   // jal  ra, update_outputs
            32'h004003B8: r_Instruction = 32'h000C8093;   // mv   ra, s9
            32'h004003BC: r_Instruction = 32'h00008067;   // ret
            32'h004003C0: r_Instruction = 32'h00BEC337;   // li   t1, RX_TIMEOUT_LOOPS
            32'h004003C4: r_Instruction = 32'h0084A283;   // lw   t0, UART_CONTROL(s1)
            32'h004003C8: r_Instruction = 32'h0022F293;   // andi t0, t0, UART_RXDONE
            32'h004003CC: r_Instruction = 32'h00029A63;   // bnez t0, _rxt_got
            32'h004003D0: r_Instruction = 32'hFFF30313;   // addi t1, t1, -1
            32'h004003D4: r_Instruction = 32'hFE0318E3;   // bnez t1, _rxt_loop
            32'h004003D8: r_Instruction = 32'h00000593;   // li   a1, 0
            32'h004003DC: r_Instruction = 32'h00008067;   // ret
            32'h004003E0: r_Instruction = 32'h0004A423;   // sw   zero, UART_CONTROL(s1)
            32'h004003E4: r_Instruction = 32'h0044A503;   // lw   a0, UART_RXDATA(s1)
            32'h004003E8: r_Instruction = 32'h00100593;   // li   a1, 1
            32'h004003EC: r_Instruction = 32'h00008067;   // ret
            32'h004003F0: r_Instruction = 32'h0084A283;   // lw   t0, UART_CONTROL(s1)
            32'h004003F4: r_Instruction = 32'h0042F293;   // andi t0, t0, UART_TXDONE
            32'h004003F8: r_Instruction = 32'hFE028CE3;   // beqz t0, tx_byte
            32'h004003FC: r_Instruction = 32'h00A4A023;   // sw   a0, UART_TXDATA(s1)
            32'h00400400: r_Instruction = 32'h0084A283;   // lw   t0, UART_CONTROL(s1)
            32'h00400404: r_Instruction = 32'h0012E293;   // ori  t0, t0, UART_TRANSMIT
            32'h00400408: r_Instruction = 32'h0054A423;   // sw   t0, UART_CONTROL(s1)
            32'h0040040C: r_Instruction = 32'h00008067;   // ret
            32'h00400410: r_Instruction = 32'h00000393;   // li   t2, 0
            32'h00400414: r_Instruction = 32'h02CDA283;   // lw   t0, ST_CLASS(s11)
            32'h00400418: r_Instruction = 32'h00028A63;   // beqz t0, _uo_current
            32'h0040041C: r_Instruction = 32'h01000393;   // li   t2, PIN_FAN_BOOST
            32'h00400420: r_Instruction = 32'h00100313;   // li   t1, 1
            32'h00400424: r_Instruction = 32'h00628463;   // beq  t0, t1, _uo_current
            32'h00400428: r_Instruction = 32'h02000393;   // li   t2, PIN_FAN_MAX
            32'h0040042C: r_Instruction = 32'h044DA303;   // lw   t1, ST_OVERLOAD(s11)
            32'h00400430: r_Instruction = 32'h00030463;   // beqz t1, _uo_epo
            32'h00400434: r_Instruction = 32'h0403E393;   // ori  t2, t2, PIN_OVERLOAD
            32'h00400438: r_Instruction = 32'h034DA303;   // lw   t1, ST_EPO(s11)
            32'h0040043C: r_Instruction = 32'h00030463;   // beqz t1, _uo_write
            32'h00400440: r_Instruction = 32'h0803E393;   // ori  t2, t2, PIN_EPO
            32'h00400444: r_Instruction = 32'h00742023;   // sw   t2, GPIO_DATAOUT(s0)
            32'h00400448: r_Instruction = 32'h00008067;   // ret

            default: r_Instruction = 32'h00000000;
        endcase
    end
endmodule



//  ---------- INLCUDED BLOCK: GPIO_PIN_SPLIT  ---------- 
module GPIO_PIN_SPLIT (
    input  wire [7:0] i_Pins_Out,   // from GPIO.o_Pins_Out (DATAOUT)
    input  wire [7:0] i_Pins_Oe,    // from GPIO.o_Pins_Oe  (DATADIR, 1 = output)
    output wire [7:0] o_Pins_In,    // to   GPIO.i_Pins_In

    // to Inout Pin k: C (value driven) and D (direction, 1 = output)
    output wire       o_C0, o_C1, o_C2, o_C3, o_C4, o_C5, o_C6, o_C7,
    output wire       o_D0, o_D1, o_D2, o_D3, o_D4, o_D5, o_D6, o_D7,

    // from Inout Pin k: the pin itself
    input  wire       i_P0, i_P1, i_P2, i_P3, i_P4, i_P5, i_P6, i_P7
);
    assign {o_C7, o_C6, o_C5, o_C4, o_C3, o_C2, o_C1, o_C0} = i_Pins_Out;
    assign {o_D7, o_D6, o_D5, o_D4, o_D3, o_D2, o_D1, o_D0} = i_Pins_Oe;
    assign o_Pins_In = {i_P7, i_P6, i_P5, i_P4, i_P3, i_P2, i_P1, i_P0};
endmodule


// Automatically generated by ChipInventor Cloud EDA Tool - 3.15
// Careful: this file (hdl.v) will be automatically replaced
// when you ask tool to generate top Verilog code by clicking
// at BLOCKS button.

module top (

  input wire clk_i,
  input wire rst_i,
  output wire [31:0] o_PC,
  output wire [1:0] o_State,
  output wire o_RD_We,
  input wire rx_i,
  output wire tx_o,
  inout  pins_io_0,
  inout  pins_io_1,
  inout  pins_io_2,
  inout  pins_io_3,
  inout  pins_io_4,
  inout  pins_io_5,
  inout  pins_io_6,
  inout  pins_io_7

);

//Internal Wires
 wire [31:0] w_1;
 wire w_2;
 wire w_3;
 wire w_4;
 wire [1:0] w_5;
 wire [3:0] w_6;
 wire w_7;
 wire w_8;
 wire [3:0] w_9;
 wire [3:0] w_10;
 wire [2:0] w_11;
 wire w_12;
 wire w_14;
 wire w_16;
 wire w_18;
 wire [31:0] w_19;
 wire [31:0] w_20;
 wire [2:0] w_21;
 wire [31:0] w_22;
 wire [31:0] w_23;
 wire [31:0] w_25;
 wire [31:0] w_26;
 wire [31:0] w_27;
 wire [31:0] w_31;
 wire [31:0] w_34;
 wire [4:0] w_35;
 wire [4:0] w_36;
 wire [4:0] w_37;
 wire [31:0] w_38;
 wire [31:0] w_42;
 wire [31:0] w_44;
 wire [31:0] w_45;
 wire [31:0] w_46;
 wire [3:0] w_47;
 wire [31:0] w_48;
 wire [31:0] w_52;
 wire [31:0] w_54;
 wire w_55;
 wire w_56;
 wire [3:0] w_57;
 wire [31:0] w_58;
 wire [31:0] w_59;
 wire w_60;
 wire w_61;
 wire [7:0] w_62;
 wire [31:0] w_63;
 wire [7:0] w_64;
 wire [7:0] w_65;
 wire [31:0] w_66;
 wire [31:0] w_67;
 wire [31:0] w_68;
 wire w_69;
 wire [31:0] w_70;
 wire w_71;
 wire w_72;
 wire w_73;
 wire w_74;
 wire w_75;
 wire w_76;
 wire w_77;
 wire w_78;
 wire w_79;
 wire w_80;
 wire w_81;
 wire w_82;
 wire w_83;
 wire w_84;
 wire w_85;
 wire w_86;
 wire w_87;
 wire w_88;

//Interface Assigns
assign o_PC[31:0] = w_23;
assign o_RD_We = w_12;
	assign  pins_io_0 = w_73 ? w_74 : 1'bZ ;
	assign  pins_io_1 = w_75 ? w_76 : 1'bZ ;
	assign  pins_io_2 = w_77 ? w_78 : 1'bZ ;
	assign  pins_io_3 = w_79 ? w_80 : 1'bZ ;
	assign  pins_io_4 = w_81 ? w_82 : 1'bZ ;
	assign  pins_io_5 = w_83 ? w_84 : 1'bZ ;
	assign  pins_io_6 = w_85 ? w_86 : 1'bZ ;
	assign  pins_io_7 = w_87 ? w_88 : 1'bZ ;

//Instances of Modules
Control_Unit blk3000_35 (
         .i_Clk (clk_i),
         .i_Rst (rst_i),
         .o_State (o_State[1:0]),
         .o_RD_We (w_12),
         .i_Instruction (w_1),
         .i_Branch_Taken (w_2),
         .o_IR_Write (w_3),
         .o_PC_Write (w_4),
         .o_PC_Src (w_5),
         .o_ALU_Op (w_6),
         .o_ALU_SrcA (w_7),
         .o_ALU_SrcB (w_8),
         .o_Mul_Op (w_9),
         .o_CRC_Op (w_10),
         .o_WB_Sel (w_11),
         .o_Mem_We (w_14),
         .o_Mem_Oe (w_16),
         .o_Addr_Src (w_18)
     );

BRANCH_COMPARATOR blk2820_37 (
         .o_Branch_Taken (w_2),
         .i_Reg_A (w_19),
         .i_Reg_B (w_20),
         .i_Branch_Sel (w_21)
     );

PC_Unit blk3324_39 (
         .i_Clk (clk_i),
         .i_Rst (rst_i),
         .o_PC (w_23),
         .i_PC_Write (w_4),
         .i_PC_Src (w_5),
         .i_ALU_Result (w_22),
         .o_PC_Plus4 (w_25)
     );

alu blk2723_40 (
         .sel_i (w_6),
         .q_o (w_22),
         .a_i (w_26),
         .b_i (w_27)
     );

MULT_Unit blk2761_41 (
         .i_Mul_Op (w_9),
         .i_rs1 (w_19),
         .i_rs2 (w_20),
         .o_Result (w_31)
     );

CRC16_Unit blk2756_42 (
         .i_CRC_Op (w_10),
         .i_rs1 (w_19),
         .i_rs2 (w_20),
         .o_Result (w_34)
     );

Register_File blk2832_43 (
         .i_clk (clk_i),
         .i_rst (rst_i),
         .i_we (w_12),
         .o_rs1_data (w_19),
         .o_rs2_data (w_20),
         .i_rs1_addr (w_35),
         .i_rs2_addr (w_36),
         .i_rd_addr (w_37),
         .i_rd_data (w_38)
     );

LSU blk2775_44 (
         .we_i (w_14),
         .oe_i (w_16),
         .core_data_o (w_20),
         .core_address_o (w_42),
         .op_size_o (w_21),
         .mem_data_i (w_44),
         .core_data_i (w_45),
         .mem_address_i (w_46),
         .byte_write_i (w_47),
         .mem_data_o (w_48)
     );

Datapath_Mux blk3326_45 (
         .i_Clk (clk_i),
         .i_Rst (rst_i),
         .o_IR (w_1),
         .i_IR_Write (w_3),
         .i_ALU_SrcA (w_7),
         .i_ALU_SrcB (w_8),
         .i_WB_Sel (w_11),
         .i_Addr_Src (w_18),
         .o_Funct3 (w_21),
         .i_PC (w_23),
         .i_PC_Plus4 (w_25),
         .o_ALU_A (w_26),
         .o_ALU_B (w_27),
         .i_ALU_Result (w_22),
         .i_Mul_Result (w_31),
         .i_CRC_Result (w_34),
         .o_RS1_Addr (w_35),
         .o_RS2_Addr (w_36),
         .o_RD_Addr (w_37),
         .o_WB_Data (w_38),
         .i_RS1 (w_19),
         .i_RS2 (w_20),
         .o_Address (w_42),
         .i_LSU_Data (w_45),
         .i_Instruction_In (w_44),
         .i_Immediate (w_52)
     );

IMM_GENERATOR blk2830_47 (
         .o_Immediate (w_52),
         .i_Instruction (w_1)
     );

DMEM blk2976_48 (
         .i_Clk (clk_i),
         .i_Data (w_48),
         .i_Address (w_54),
         .i_We (w_55),
         .i_Oe (w_56),
         .i_Bw (w_57),
         .o_Data (w_58)
     );

GPIO blk4579_59 (
         .i_Clk (clk_i),
         .i_Rst (rst_i),
         .i_Data (w_48),
         .i_Address (w_59),
         .i_We (w_60),
         .i_Oe (w_61),
         .i_Pins_In (w_62),
         .o_Data (w_63),
         .o_Pins_Out (w_64),
         .o_Pins_Oe (w_65)
     );

Addr_dec blk2847_64 (
         .i_core_we (w_14),
         .i_core_oe (w_16),
         .o_core_data (w_44),
         .i_core_address (w_46),
         .i_core_bw (w_47),
         .o_dmem_address (w_54),
         .o_dmem_we (w_55),
         .o_dmem_oe (w_56),
         .o_dmem_bw (w_57),
         .i_dmem_data (w_58),
         .o_gpio_address (w_59),
         .o_gpio_we (w_60),
         .o_gpio_oe (w_61),
         .i_gpio_data (w_63),
         .i_imem_data (w_66),
         .i_uart_data (w_67),
         .o_imem_address (w_68),
         .o_imem_oe (w_69),
         .o_uart_address (w_70),
         .o_uart_we (w_71),
         .o_uart_oe (w_72)
     );

UART #(.TX_ON_TXDATA_WRITE(0)) blk4605_67 (
         .i_Clk (clk_i),
         .i_Rst (rst_i),
         .i_Rx (rx_i),
         .o_Tx (tx_o),
         .i_Data (w_48),
         .o_Data (w_67),
         .i_Address (w_70),
         .i_We (w_71),
         .i_Oe (w_72)
     );

GPIO_PIN_SPLIT blk4774_76 (
         .i_P0 (pins_io_0),
         .i_P1 (pins_io_1),
         .i_P2 (pins_io_2),
         .i_P3 (pins_io_3),
         .i_P4 (pins_io_4),
         .i_P5 (pins_io_5),
         .i_P6 (pins_io_6),
         .i_P7 (pins_io_7),
         .o_Pins_In (w_62),
         .i_Pins_Out (w_64),
         .i_Pins_Oe (w_65),
         .o_D0 (w_73),
         .o_C0 (w_74),
         .o_D1 (w_75),
         .o_C1 (w_76),
         .o_D2 (w_77),
         .o_C2 (w_78),
         .o_D3 (w_79),
         .o_C3 (w_80),
         .o_D4 (w_81),
         .o_C4 (w_82),
         .o_D5 (w_83),
         .o_C5 (w_84),
         .o_D6 (w_85),
         .o_C6 (w_86),
         .o_D7 (w_87),
         .o_C7 (w_88)
     );

IMEM_Data_Center blk4721_87 (
         .o_Data (w_66),
         .i_Address (w_68),
         .i_Oe (w_69)
     );


endmodule
