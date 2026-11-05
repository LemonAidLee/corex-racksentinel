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