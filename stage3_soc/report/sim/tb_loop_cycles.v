`timescale 1ns / 1ps
// Measures the clock cycles of one _rxt_loop iteration (rx_byte_timeout, 0x004003C4)
// on the V2 export, by timing successive visits of o_PC to the loop head.
module testbench();
    localparam integer CLK_NS = 40;
    localparam real BIT_NS = 217 * CLK_NS;
    reg clk = 0, rst = 1, rx = 1'b1;
    always #(CLK_NS / 2) clk = ~clk;
    wire tx; wire [31:0] pc; wire [7:0] pins_io;
    assign pins_io[3:0] = 4'h0;
    top DUT (.clk_i(clk), .rst_i(rst), .rx_i(rx), .tx_o(tx), .o_PC(pc),
        .pins_io_0(pins_io[0]), .pins_io_1(pins_io[1]), .pins_io_2(pins_io[2]), .pins_io_3(pins_io[3]),
        .pins_io_4(pins_io[4]), .pins_io_5(pins_io[5]), .pins_io_6(pins_io[6]), .pins_io_7(pins_io[7]));
    task send_byte(input [7:0] b); integer k; begin
        rx = 0; #(BIT_NS); for (k = 0; k < 8; k = k + 1) begin rx = b[k]; #(BIT_NS); end rx = 1; #(BIT_NS); end
    endtask
    integer cyc = 0, last = -1, n = 0;
    always @(posedge clk) cyc <= cyc + 1;
    reg [31:0] pc_q = 0;
    always @(posedge clk) begin
        pc_q <= pc;
        if (pc == 32'h004003C4 && pc_q != 32'h004003C4) begin
            if (last >= 0 && n < 6) $display("loop iteration: %0d cycles", cyc - last);
            last = cyc; n = n + 1;
        end
    end
    initial begin
        repeat (4) @(posedge clk); @(negedge clk) rst = 0;
        repeat (500) @(posedge clk);
        send_byte(8'h50);              // STATUS command byte only: firmware now waits in rx_byte_timeout
        repeat (400) @(posedge clk);
        $display("timeout at 250 MHz = %0.3f s", 12500992.0 * (cyc > 0 ? 1 : 1) * 20 / 250e6);
        $finish;
    end
endmodule
