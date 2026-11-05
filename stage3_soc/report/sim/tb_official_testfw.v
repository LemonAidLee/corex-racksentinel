`timescale 1ns / 1ps

// Official RVBL-GPIO-UART-Test-Firmware on the V2 ChipInventor export
// (top_testfw.v = stage3_design-2026.09.29_ver2 top.v with only the ROM swapped).
// Follows the firmware README: 0xA on P3-P0 before the first GPIO read -> 0xA on
// P7-P4; 0x30 on RX -> 0x30 on TX; every wait has a timeout that fails loudly.
// Round 2 (0x5, then 0x55) shows the documented ordering: a new GPIO value is
// read only after the next UART echo.
module testbench();
    localparam integer CLK_NS  = 40;                       // 25 MHz
    localparam integer DIVISOR = 25_000_000 / 115_200;     // 217
    localparam real    BIT_NS  = DIVISOR * CLK_NS;         // 8680 ns

    reg clk = 0, rst = 1;
    always #(CLK_NS / 2) clk = ~clk;

    reg  rx = 1'b1;
    wire tx;
    wire [7:0] pins_io;
    reg  [3:0] pin_in = 4'h0;
    assign pins_io[3:0] = pin_in;
    wire [3:0] p_out = pins_io[7:4];

    top DUT (
        .clk_i(clk), .rst_i(rst), .rx_i(rx), .tx_o(tx),
        .pins_io_0(pins_io[0]), .pins_io_1(pins_io[1]),
        .pins_io_2(pins_io[2]), .pins_io_3(pins_io[3]),
        .pins_io_4(pins_io[4]), .pins_io_5(pins_io[5]),
        .pins_io_6(pins_io[6]), .pins_io_7(pins_io[7])
    );

    integer errors = 0;

    task send_byte(input [7:0] b);
        integer k;
        begin
            rx = 1'b0; #(BIT_NS);
            for (k = 0; k < 8; k = k + 1) begin rx = b[k]; #(BIT_NS); end
            rx = 1'b1; #(BIT_NS);
        end
    endtask

    task recv_byte(output [7:0] b);
        integer m, n;
        begin
            b = 8'h00; n = 0;
            while (tx !== 1'b0 && n < 100000) begin @(posedge clk); n = n + 1; end
            if (tx !== 1'b0) begin
                $display("[FAIL] UART: timeout, no byte on TX"); errors = errors + 1;
            end else begin
                #(BIT_NS / 2.0);
                for (m = 0; m < 8; m = m + 1) begin #(BIT_NS) b[m] = tx; end
                #(BIT_NS);
                if (tx !== 1'b1) begin $display("[FAIL] UART: bad stop bit"); errors = errors + 1; end
            end
        end
    endtask

    task wait_gpio(input [3:0] want, input [8*40-1:0] what);
        integer n;
        begin
            n = 0;
            while (p_out !== want && n < 20000) begin @(posedge clk); n = n + 1; end
            if (p_out === want) $display("[PASS] GPIO: P3-P0 = 0x%0h, P7-P4 = 0x%0h%0s", pin_in, p_out, what);
            else begin $display("[FAIL] GPIO: timeout, P7-P4 = 0x%0h, expected 0x%0h", p_out, want); errors = errors + 1; end
        end
    endtask

    task uart_echo(input [7:0] b);
        reg [7:0] got;
        begin
            fork
                send_byte(b);
                recv_byte(got);
            join
            if (got === b) $display("[PASS] UART: RX = 0x%0h, TX = 0x%0h", b, got);
            else begin $display("[FAIL] UART: RX = 0x%0h, TX = 0x%0h", b, got); errors = errors + 1; end
        end
    endtask

    initial begin
        $dumpfile("testfw.vcd");
        $dumpvars(0, testbench.clk, testbench.rst, testbench.pin_in, testbench.p_out,
                     testbench.rx, testbench.tx);
        $display("Official GPIO + UART test firmware  (./emu -d 0xF0 -i 0x0A -o 0xA0 -t1 0x30 -r1 0x30)");
        pin_in = 4'hA;                                   // present before the first GPIO read
        repeat (4) @(posedge clk);
        @(negedge clk) rst = 1'b0;
        wait_gpio(4'hA, "");
        uart_echo(8'h30);
        pin_in = 4'h5;                                   // new value, not yet read
        repeat (2000) @(posedge clk);
        if (p_out === 4'hA) $display("[PASS] GPIO: P7-P4 holds 0xA while the firmware waits for UART (new P3-P0 = 0x5 not yet read)");
        else begin $display("[FAIL] GPIO: P7-P4 changed before the UART echo"); errors = errors + 1; end
        uart_echo(8'h55);
        wait_gpio(4'h5, " after the echo");
        if (errors == 0) $display("[PASS] GPIO and UART firmware test completed successfully");
        else             $display("[FAIL] %0d check(s) failed", errors);
        $finish;
    end

    initial begin #(5_000_000); $display("[FAIL] watchdog timeout"); $finish; end
endmodule
