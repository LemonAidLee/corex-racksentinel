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