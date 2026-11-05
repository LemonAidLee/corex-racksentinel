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