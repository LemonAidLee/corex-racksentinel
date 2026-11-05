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