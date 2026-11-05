`timescale 1ns / 1ps

// Final Official Stage 3 GPIO + UART Testbench
// ChipInventor SoC: 25 MHz, UART 115200 bps
//
// Official validation:
//   GPIO: P3-P0 = 0xA  -> P7-P4 = 0xA
//   UART: RX = 0x30    -> TX = 0x30
//
// Additional validation:
//   - DATADIR = 0xF0
//   - Firmware execution ordering
//   - Four extra GPIO/UART patterns
//   - Final top-level pins_io_0...pins_io_7 path
//   - UART timeout and global watchdog

`define GPIO_INST DUT.blk4579_59

module testbench();

    localparam integer CLK_NS       = 40;                    // 25 MHz
    localparam integer DIVISOR      = 25_000_000 / 115_200; // 217
    localparam real    BIT_NS       = DIVISOR * CLK_NS;
    localparam integer UART_TIMEOUT = 30 * DIVISOR;
    localparam integer GPIO_TIMEOUT = 2000;
    localparam integer N            = 4;

    reg clk = 0, rst = 1;
    always #(CLK_NS/2) clk = ~clk;

    reg rx = 1'b1;
    wire tx;

    // Final top-level bidirectional GPIO interface
    tri [7:0] pins_io;
    reg [3:0] pins_in = 4'hA;     // Official 0xA present before reset ends
    assign pins_io[3:0] = pins_in;

    wire [3:0] gpio_out = pins_io[7:4];

    // Final ChipInventor SoC
    top DUT (
        .clk_i(clk), .rst_i(rst),
        .rx_i(rx), .tx_o(tx),
        .pins_io_0(pins_io[0]), .pins_io_1(pins_io[1]),
        .pins_io_2(pins_io[2]), .pins_io_3(pins_io[3]),
        .pins_io_4(pins_io[4]), .pins_io_5(pins_io[5]),
        .pins_io_6(pins_io[6]), .pins_io_7(pins_io[7])
    );

    // Diagnostic only.
    // Functional GPIO tests use the final top-level pins.
    wire [7:0] pins_oe = `GPIO_INST.o_Pins_Oe;

    // Byte-level signals for clearer waveform viewing
    reg [7:0] rx_byte = 8'h00;
    reg [7:0] tx_byte = 8'h00;

    integer checks = 0, errors = 0;
    integer i, err0;

    reg [7:0] bytes [0:N-1];
    reg [3:0] nib   [0:N-1];

    reg st, sp;

    // ============================================================
    // INTERNAL CHECK
    // Only prints when a check fails.
    // ============================================================
    task verify(
        input cond,
        input [8*64-1:0] what,
        input [31:0] got,
        input [31:0] want
    );
        begin
            checks = checks + 1;

            if (cond !== 1'b1) begin
                errors = errors + 1;

                $display(
                    "[FAIL] %0s: got 0x%0h, expected 0x%0h",
                    what, got, want
                );
            end
        end
    endtask

    // ============================================================
    // UART SEND
    // 8-N-1, LSB first
    // ============================================================
    task uart_send(input [7:0] b);
        integer j;
        begin
            rx_byte = b;

            // Start bit
            rx = 1'b0;
            #(BIT_NS);

            // Data bits
            for (j = 0; j < 8; j = j + 1) begin
                rx = b[j];
                #(BIT_NS);
            end

            // Stop bit
            rx = 1'b1;
            #(BIT_NS);
        end
    endtask

    // ============================================================
    // UART RECEIVE
    // Includes timeout protection.
    // ============================================================
    task uart_receive(
        output [7:0] b,
        output valid
    );
        integer j;
        integer w;

        begin
            valid = 1'b0;
            b = 8'h00;
            w = 0;

            // Wait for start bit
            while ((tx !== 1'b0) && (w < UART_TIMEOUT)) begin
                @(posedge clk);
                w = w + 1;
            end

            if (tx === 1'b0) begin

                // Middle of start bit
                #(BIT_NS/2.0);
                st = tx;

                // Data bits
                for (j = 0; j < 8; j = j + 1) begin
                    #(BIT_NS);
                    b[j] = tx;
                end

                // Stop bit
                #(BIT_NS);
                sp = tx;

                valid = (st === 1'b0) &&
                        (sp === 1'b1);

                tx_byte = b;
            end
        end
    endtask

    // ============================================================
    // UART CHECK
    // Two internal checks:
    //   1. valid frame
    //   2. correct echoed byte
    // ============================================================
    task uart_check(input [7:0] expected);
        reg [7:0] got;
        reg valid;

        begin
            fork
                uart_send(expected);
                uart_receive(got, valid);
            join

            verify(
                valid,
                "UART frame start/stop bits",
                valid,
                1
            );

            verify(
                got === expected,
                "UART echoed byte",
                got,
                expected
            );
        end
    endtask

    // ============================================================
    // GPIO CHECK WITH TIMEOUT
    // ============================================================
    task gpio_wait_check(
        input [3:0] expected,
        input [8*64-1:0] what
    );
        integer t;

        begin
            t = 0;

            while ((gpio_out !== expected) &&
                   (t < GPIO_TIMEOUT)) begin

                @(posedge clk);
                t = t + 1;
            end

            verify(
                gpio_out === expected,
                what,
                gpio_out,
                expected
            );
        end
    endtask

    // ============================================================
    // MAIN TEST
    // ============================================================
    initial begin

        $dumpfile("testbench.vcd");
        $dumpvars(2, testbench);

        // Four additional verification patterns
        bytes[0] = 8'h20; nib[0] = 4'h2;
        bytes[1] = 8'hA5; nib[1] = 4'hF;
        bytes[2] = 8'h00; nib[2] = 4'h9;
        bytes[3] = 8'hFF; nib[3] = 4'h6;

        $display("======================================================");
        $display(" Official Stage 3 GPIO/UART Firmware Test");
        $display("======================================================");

        // --------------------------------------------------------
        // RESET
        // Official GPIO input 0xA is already applied before
        // reset is released, matching the organizer's sequence.
        // --------------------------------------------------------
        repeat (5) @(posedge clk);

        @(negedge clk);
        rst = 1'b0;

        // Allow firmware to configure DATADIR
        repeat (100) @(posedge clk);

        // --------------------------------------------------------
        // GPIO DIRECTION CHECK
        // --------------------------------------------------------
        verify(
            pins_oe === 8'hF0,
            "DATADIR = 0xF0",
            pins_oe,
            8'hF0
        );

        // --------------------------------------------------------
        // 1. OFFICIAL GPIO TEST
        // P3-P0 = A -> P7-P4 = A
        // --------------------------------------------------------
        err0 = errors;

        gpio_wait_check(
            4'hA,
            "Official GPIO P3-P0=A -> P7-P4=A"
        );

        if (errors == err0)
            $display(
                "[PASS] GPIO: P3-P0 = 0xA, P7-P4 = 0xA"
            );

        // --------------------------------------------------------
        // 2. OFFICIAL UART TEST
        // RX 30 -> TX 30
        // --------------------------------------------------------
        err0 = errors;

        uart_check(8'h30);

        if (errors == err0)
            $display(
                "[PASS] UART: RX = 0x30, TX = 0x30"
            );

        $display(
            "Equivalent ./emu: -d 0xF0 -i 0x0A -t1 0x30 -r1 0x30 -o 0xA0"
        );

        // --------------------------------------------------------
        // 3. FIRMWARE EXECUTION ORDERING
        //
        // After echoing 0x30, firmware loops and waits for UART.
        // Change GPIO input A -> 5.
        // Output must remain A until another UART echo completes.
        // --------------------------------------------------------
        repeat (300) @(posedge clk);

        err0 = errors;

        @(negedge clk);
        pins_in = 4'h5;

        repeat (300) @(posedge clk);

        verify(
            gpio_out === 4'hA,
            "GPIO remains A while firmware waits for UART",
            gpio_out,
            4'hA
        );

        uart_check(8'h55);

        gpio_wait_check(
            4'h5,
            "GPIO becomes 5 after UART echo"
        );

        if (errors == err0)
            $display(
                "[PASS] Firmware ordering: GPIO update occurs after UART echo"
            );

        // --------------------------------------------------------
        // 4. ADDITIONAL VERIFICATION
        // --------------------------------------------------------
        $display("");
        $display("[ADDITIONAL VERIFICATION]");

        for (i = 0; i < N; i = i + 1) begin

            err0 = errors;

            @(negedge clk);
            pins_in = nib[i];

            repeat (200) @(posedge clk);

            uart_check(bytes[i]);

            gpio_wait_check(
                nib[i],
                "Additional GPIO copy"
            );

            if (errors == err0) begin

                $display(
                    "[PASS] Test %0d: GPIO 0x%01h -> 0x%01h | UART 0x%02h -> 0x%02h",
                    i + 1,
                    nib[i],
                    gpio_out,
                    bytes[i],
                    tx_byte
                );

            end
            else begin

                $display(
                    "[FAIL] Test %0d: additional GPIO/UART verification",
                    i + 1
                );

            end
        end

        // --------------------------------------------------------
        // FINAL SUMMARY
        // --------------------------------------------------------
        $display("");
        $display(
            "Internal checks: %0d, failures: %0d",
            checks,
            errors
        );

        if (errors == 0)
            $display(
                "[PASS] GPIO and UART firmware test completed successfully"
            );
        else
            $display(
                "[FAIL] GPIO and UART firmware test failed"
            );

        $display("======================================================");

        $finish;
    end

    // ============================================================
    // GLOBAL WATCHDOG
    // ============================================================
    initial begin

        #(BIT_NS * 300);

        $display(
            "[FAIL] timeout: official firmware test did not complete"
        );

        $finish;
    end

endmodule
