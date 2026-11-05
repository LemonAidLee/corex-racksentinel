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