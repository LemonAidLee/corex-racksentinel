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