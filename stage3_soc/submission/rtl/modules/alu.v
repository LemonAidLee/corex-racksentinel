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