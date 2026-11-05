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