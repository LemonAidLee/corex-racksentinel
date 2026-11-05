

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



//  ---------- INLCUDED BLOCK: Address_Decoder  ---------- 
module Address_Decoder (
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
 
    output reg  [31:0] o_core_data
);
    localparam [31:0] IMEM_BASE = 32'h00400000;
    localparam [31:0] DMEM_BASE = 32'h10010000;
    localparam [31:0] IMEM_MASK = 32'hFFC00000;   // 4 MB region
    localparam [31:0] DMEM_MASK = 32'hFFFFE000;   // 8 kB region
 
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



//  ---------- INLCUDED BLOCK: IMEM_MOCK  ---------- 
module IMEM_MOCK (
    input  wire [31:0] i_Address,
    input  wire        i_Oe,          // routed per 4.4; unused internally
    output reg  [31:0] o_Data
);
    // OpenLane synthesis mock — do NOT use for functional/processor
    // validation. Keeps the IMEM as a tiny case block instead of a
    // 1024-word ROM array, since the full firmware would generate
    // unnecessary cells for a physical-implementation-only run.
    // Program: x5=10; x6=5; x7=x5+x6 -> x7=15
    always @(*) begin
        case (i_Address)
            32'h0040_0000: o_Data = 32'h00A0_0293; // addi x5, x0, 10
            32'h0040_0004: o_Data = 32'h0050_0313; // addi x6, x0, 5
            32'h0040_0008: o_Data = 32'h0062_83B3; // add  x7, x5, x6

            default:
                o_Data = 32'h0000_0013; // addi x0, x0, 0  (NOP)
        endcase
    end
endmodule



//  ---------- INLCUDED BLOCK: DMEM_MOCK  ---------- 
module DMEM_MOCK (
    input  wire        i_Clk,
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [3:0]  i_Bw,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data
);
    localparam DEPTH_W = 4;        // 2048 words = 8 kB
    localparam IDX_HI  = 3;          // log2(8192) - 1
 
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


// Automatically generated by ChipInventor Cloud EDA Tool - 3.15
// Careful: this file (hdl.v) will be automatically replaced
// when you ask tool to generate top Verilog code by clicking
// at BLOCKS button.

module top (

  input wire clk_i,
  input wire rst_i,
  output wire [31:0] o_PC,
  output wire [1:0] o_State,
  output wire o_RD_We

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
 wire [31:0] w_50;
 wire [31:0] w_52;
 wire [31:0] w_53;
 wire [31:0] w_54;
 wire w_55;
 wire [31:0] w_56;
 wire w_57;
 wire w_58;
 wire [3:0] w_59;

//Interface Assigns
assign o_PC[31:0] = w_23;
assign o_RD_We = w_12;

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
         .i_Immediate (w_50)
     );

Address_Decoder blk2847_46 (
         .i_core_we (w_14),
         .i_core_oe (w_16),
         .o_core_data (w_44),
         .i_core_address (w_46),
         .i_core_bw (w_47),
         .i_imem_data (w_52),
         .i_dmem_data (w_53),
         .o_imem_address (w_54),
         .o_imem_oe (w_55),
         .o_dmem_address (w_56),
         .o_dmem_we (w_57),
         .o_dmem_oe (w_58),
         .o_dmem_bw (w_59)
     );

IMM_GENERATOR blk2830_47 (
         .o_Immediate (w_50),
         .i_Instruction (w_1)
     );

IMEM_MOCK blk3584_59 (
         .o_Data (w_52),
         .i_Address (w_54),
         .i_Oe (w_55)
     );

DMEM_MOCK blk4217_60 (
         .i_Clk (clk_i),
         .i_Data (w_48),
         .o_Data (w_53),
         .i_Address (w_56),
         .i_We (w_57),
         .i_Oe (w_58),
         .i_Bw (w_59)
     );


endmodule
