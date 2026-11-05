module DMEM (
    input  wire        i_Clk,
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [3:0]  i_Bw,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data
);
    localparam DEPTH_W = 2048;        // 2048 words = 8 kB
    localparam IDX_HI  = 12;          // log2(8192) - 1
 
    reg [31:0] r_Ram [0:DEPTH_W-1];
 
    wire [IDX_HI-2:0] w_Index = i_Address[IDX_HI:2];
 
    always @(posedge i_Clk) begin
        // synchronous read: capture before any write commits
        if (i_Oe) o_Data <= r_Ram[w_Index];
 
        // per-byte write
        if (i_We) begin
            if (i_Bw[0]) r_Ram[w_Index][7:0]   <= i_Data[7:0];
            if (i_Bw[1]) r_Ram[w_Index][15:8]  <= i_Data[15:8];
            if (i_Bw[2]) r_Ram[w_Index][23:16] <= i_Data[23:16];
            if (i_Bw[3]) r_Ram[w_Index][31:24] <= i_Data[31:24];
        end
    end
endmodule