module Address_Decoder (
    input  wire [31:0] i_core_address,
    input  wire        i_core_we,
    input  wire        i_core_oe,
    input  wire [3:0]  i_core_bw,
 
    output reg  [31:0] o_imem_address,
    output reg         o_imem_oe,
    input  wire [31:0] i_imem_data,
 
    output reg  [31:0] o_dmem_address,
    output reg         o_dmem_we,
    output reg         o_dmem_oe,
    output reg  [3:0]  o_dmem_bw,
    input  wire [31:0] i_dmem_data,
 
    output reg  [31:0] o_core_data
);
    localparam [31:0] IMEM_BASE = 32'h00400000;
    localparam [31:0] DMEM_BASE = 32'h10010000;
    localparam [31:0] IMEM_MASK = 32'hFFC00000;   // 4 MB region
    localparam [31:0] DMEM_MASK = 32'hFFFFE000;   // 8 kB region
 
    always @(*) begin
        // Defaults prevent latches
        o_imem_address = {i_core_address[31:2], 2'b00};
        o_imem_oe      = 1'b0;
 
        o_dmem_address = {i_core_address[31:2], 2'b00};
        o_dmem_we      = 1'b0;
        o_dmem_oe      = 1'b0;
        o_dmem_bw      = 4'b0000;
 
        o_core_data    = 32'd0;
 
        if ((i_core_address & IMEM_MASK) == IMEM_BASE) begin
            // IMEM: read only. we and bw are never routed here.
            o_imem_oe   = i_core_oe;
            o_core_data = i_imem_data;
        end
        else if ((i_core_address & DMEM_MASK) == DMEM_BASE) begin
            o_dmem_oe   = i_core_oe;
            o_dmem_we   = i_core_we;
            o_dmem_bw   = i_core_bw;
            o_core_data = i_dmem_data;
        end
    end
endmodule