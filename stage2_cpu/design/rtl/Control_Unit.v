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