`timescale 1ns / 1ps
module LSU (
    // Interface to RISC-V Datapath / Core
    input  wire [31:0] core_data_o,    // Data to be stored (Store instructions)
    input  wire [31:0] core_address_o, // Memory address calculated by ALU
    input  wire [2:0]  op_size_o,      // Operation size / type (funct3)
    input  wire        we_i,           // Write Enable from Control Unit
    input  wire        oe_i,           // Output Enable (Read) from Control Unit
    output reg  [31:0] core_data_i,    // Data returned to the core (Load instructions)

    // Interface to DMEM / Address Decoder
    input  wire [31:0] mem_data_i,     // Raw 32-bit word read from DMEM
    output reg  [31:0] mem_address_i,  // Aligned address sent to memory (bottom 2 bits ignored)
    output reg  [3:0]  byte_write_i,   // 4-bit byte-enable write mask for DMEM
    output reg  [31:0] mem_data_o      // Formatted data written to DMEM
);

    // Extract bottom 2 bits for byte offset within the 32-bit word
    wire [1:0] byte_offset = core_address_o[1:0];

    // Align address to 4 bytes by clearing the bottom 2 bits
    always @(*) begin
        mem_address_i = {core_address_o[31:2], 2'b00};
    end

    // ---------------------------------------------------------
    // STORE LOGIC (Writing to Memory)
    // ---------------------------------------------------------
     always @(*) begin
        mem_data_o   = 32'd0;
        byte_write_i = 4'b0000;
        if (we_i) begin
            case (op_size_o)                     // was op_size_o[1:0]
                3'b000: case (byte_offset)       // sb
                    2'b00: begin mem_data_o = {24'd0, core_data_o[7:0]};       byte_write_i = 4'b0001; end
                    2'b01: begin mem_data_o = {16'd0, core_data_o[7:0], 8'd0}; byte_write_i = 4'b0010; end
                    2'b10: begin mem_data_o = {8'd0, core_data_o[7:0], 16'd0}; byte_write_i = 4'b0100; end
                    2'b11: begin mem_data_o = {core_data_o[7:0], 24'd0};       byte_write_i = 4'b1000; end
                endcase
                3'b001: case (byte_offset[1])    // sh
                    1'b0: begin mem_data_o = {16'd0, core_data_o[15:0]};       byte_write_i = 4'b0011; end
                    1'b1: begin mem_data_o = {core_data_o[15:0], 16'd0};       byte_write_i = 4'b1100; end
                endcase
                3'b010: begin                    // sw
                    mem_data_o = core_data_o;    byte_write_i = 4'b1111;
                end
                default: begin
                    mem_data_o = 32'd0;          byte_write_i = 4'b0000;
                end
            endcase
        end
    end
    // ---------------------------------------------------------
    // LOAD LOGIC (Reading from Memory)
    // ---------------------------------------------------------
    always @(*) begin
        case (op_size_o)
            3'b000: begin // lb: Load Byte with Sign Extension
                case (byte_offset)
                    2'b00: core_data_i = {{24{mem_data_i[7]}},  mem_data_i[7:0]};
                    2'b01: core_data_i = {{24{mem_data_i[15]}}, mem_data_i[15:8]};
                    2'b10: core_data_i = {{24{mem_data_i[23]}}, mem_data_i[23:16]};
                    2'b11: core_data_i = {{24{mem_data_i[31]}}, mem_data_i[31:24]};
                endcase
            end
            3'b001: begin // lh: Load Half-word with Sign Extension
                case (byte_offset[1])
                    1'b0:  core_data_i = {{16{mem_data_i[15]}}, mem_data_i[15:0]};
                    1'b1:  core_data_i = {{16{mem_data_i[31]}}, mem_data_i[31:16]};
                endcase
            end
            3'b010: begin // lw: Load Word
                core_data_i = mem_data_i;
            end
            3'b100: begin // lbu: Load Byte Unsigned (Zero Extension)
                case (byte_offset)
                    2'b00: core_data_i = {24'd0, mem_data_i[7:0]};
                    2'b01: core_data_i = {24'd0, mem_data_i[15:8]};
                    2'b10: core_data_i = {24'd0, mem_data_i[23:16]};
                    2'b11: core_data_i = {24'd0, mem_data_i[31:24]};
                endcase
            end
            3'b101: begin // lhu: Load Half-word Unsigned (Zero Extension)
                case (byte_offset[1])
                    1'b0:  core_data_i = {16'd0, mem_data_i[15:0]};
                    1'b1:  core_data_i = {16'd0, mem_data_i[31:16]};
                endcase
            end
            default: core_data_i = mem_data_i;
        endcase
    end

endmodule