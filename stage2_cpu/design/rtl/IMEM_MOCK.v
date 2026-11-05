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