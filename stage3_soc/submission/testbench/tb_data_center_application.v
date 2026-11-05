`timescale 1ns / 1ps

// DC teammate app (dc_teammate.s, ROM IMEM_DC_TEAMMATE) on the 8-pin canvas design
// hdl_dc_teammate.v. Based on the teammate's tb_IMEM_DATA_CENTER_teammate.v; changed
// 2026-09-29 for the latching EPO with P0 reset and the removal of the power
// factor (0x47) and energy (0x51) commands, which now reply invalid:
// C07-C09 now need a P0 press after recovery; C11-C12 are new.
// FIRST_RUN..LAST_RUN selects cases 1..12.
// On the ChipInventor platform run one or two cases at a time (~3 ms limit).
module testbench();
    localparam integer FIRST_RUN = 1;
    localparam integer LAST_RUN  = 12;
    // Compatibility setting only: no extra regression suite or external file.
    parameter integer RUN_REGRESSIONS = 1;

    localparam [7:0] CMD_SAMPLE = 8'h5A;

    localparam integer CLK_NS  = 40;                       // 25 MHz
    localparam integer DIVISOR = 25_000_000 / 115_200;     // 217
    localparam real    BIT_NS  = DIVISOR * CLK_NS;         // 8680 ns
    localparam real    BYTE_NS = BIT_NS * 10;

    reg clk = 0, rst = 1;
    always #(CLK_NS / 2) clk = ~clk;

    reg  rx = 1'b1;
    wire tx;
    wire [7:0] pins_io;
    reg  [3:0] pin_in = 4'h0;                              // P0 operator reset; P1-P3 unused
    assign pins_io[3:0] = pin_in;

    // Final canvas HDL exposes eight scalar GPIO ports, not one vector port.
    top DUT (
        .clk_i(clk), .rst_i(rst), .rx_i(rx), .tx_o(tx),
        .pins_io_0(pins_io[0]), .pins_io_1(pins_io[1]),
        .pins_io_2(pins_io[2]), .pins_io_3(pins_io[3]),
        .pins_io_4(pins_io[4]), .pins_io_5(pins_io[5]),
        .pins_io_6(pins_io[6]), .pins_io_7(pins_io[7])
    );

    integer checks = 0, errors = 0;

    task check(input cond, input [8*64-1:0] what, input [31:0] got, input [31:0] want);
        begin
            checks = checks + 1;
            if (cond !== 1'b1) begin
                errors = errors + 1;
                $display("  [FAIL] t=%0t %0s: got 0x%0h, expected 0x%0h", $time, what, got, want);
            end
        end
    endtask

    // CCSDS CRC-16 (poly 0x1021, init 0xFFFF) over [c, d] -- the reference model
    function [15:0] crc16(input [7:0] c, input [7:0] d);
        integer i;
        reg [15:0] r;
        begin
            r = 16'hFFFF ^ {c, 8'h00};
            for (i = 0; i < 8; i = i + 1) r = r[15] ? ((r << 1) ^ 16'h1021) : (r << 1);
            r = r ^ {d, 8'h00};
            for (i = 0; i < 8; i = i + 1) r = r[15] ? ((r << 1) ^ 16'h1021) : (r << 1);
            crc16 = r;
        end
    endfunction

    // Four payload bytes, independently computed CRC reference (MSB-first 0x1021).
    function [15:0] sample_crc(input [7:0] volts, input [7:0] amps, input [7:0] temp);
        integer j;
        reg [31:0] payload;
        reg [15:0] r;
        begin
            payload = {CMD_SAMPLE, volts, amps, temp};
            r = 16'hFFFF;
            for (j=31; j>=0; j=j-1)
                r = (r[15] ^ payload[j]) ? ((r << 1) ^ 16'h1021) : (r << 1);
            sample_crc = r;
        end
    endfunction

    // One complete observation: V in volts RMS LN, I in 0.2 A/phase, T in 0.5 C.
    task sample_step(input [7:0] volts, input [7:0] amps, input [7:0] temp,
                     input bad_crc, input [7:0] want_reply, input [7:0] want_o,
                     input [8*64-1:0] what);
        reg [15:0] crc;
        reg [31:0] reply;
        reg ok;
        begin
            $display("SAMPLE START: %0s", what);
            crc = sample_crc(volts, amps, temp) ^ (bad_crc ? 16'h1 : 16'h0);
            fork
                begin
                    send_byte(CMD_SAMPLE); send_byte(volts); send_byte(amps); send_byte(temp);
                    send_byte(crc[7:0]); send_byte(crc[15:8]);
                end
                recv_reply(1, reply, ok);
            join
            check(ok, what, ok, 1);
            check(reply === {24'd0, want_reply}, what, reply, want_reply);
            repeat (200) @(posedge clk);
            check(pins_io[7:4] === want_o[7:4], what, pins_io[7:4], want_o[7:4]);
            $display("SAMPLE DONE: %0s; reply=%02h outputs=%02h expected=%02h", what, reply[7:0], {pins_io[7:4],4'b0}, want_o);
        end
    endtask

    task send_byte(input [7:0] b);
        integer k;
        begin
            rx = 1'b0; #(BIT_NS);
            for (k = 0; k < 8; k = k + 1) begin rx = b[k]; #(BIT_NS); end
            rx = 1'b1; #(BIT_NS);
        end
    endtask

    // One byte from tx_o; ok = 0 if no valid frame starts within wait_ns.
    task recv_byte(input real wait_ns, output [7:0] b, output ok);
        integer m;
        realtime t_end;
        reg st, sp;
        begin
            ok = 1'b0; b = 8'h00; t_end = $realtime + wait_ns;
            while (tx !== 1'b0 && $realtime < t_end) @(posedge clk);
            if (tx === 1'b0) begin
                #(BIT_NS / 2.0) st = tx;
                for (m = 0; m < 8; m = m + 1) begin #(BIT_NS) b[m] = tx; end
                #(BIT_NS) sp = tx;
                ok = (st === 1'b0) && (sp === 1'b1);
                #(BIT_NS / 2.0);
            end
        end
    endtask

    // n reply bytes, first byte most significant.
    task recv_reply(input integer n, output [31:0] v, output ok);
        integer i;
        reg [7:0] b;
        reg o;
        begin
            v = 0; ok = 1'b1;
            for (i = 0; i < n; i = i + 1) begin
                recv_byte(BYTE_NS * 40, b, o);
                ok = ok & o;
                v = (v << 8) | b;
            end
        end
    endtask

    // One ./emu step: send [c][d][CRC] (CRC's low bit flipped if bad_crc),
    // expect n reply bytes == want (arrival order, first byte most significant)
    // and, if check_o, P7-P4 == want_o[7:4].
    task step(input [7:0] c, input [7:0] d, input bad_crc, input integer n,
              input [31:0] want, input check_o, input [7:0] want_o, input [8*48-1:0] what);
        reg [15:0] crc;
        reg [31:0] v;
        reg ok;
        begin
            crc = crc16(c, d) ^ (bad_crc ? 16'h0001 : 16'h0000);
            fork
                begin send_byte(c); send_byte(d); send_byte(crc[7:0]); send_byte(crc[15:8]); end
                recv_reply(n, v, ok);
            join
            check(ok, what, ok, 1);
            check(v === want, what, v, want);
            repeat (200) @(posedge clk);
            if (check_o) check(pins_io[7:4] === want_o[7:4], what, pins_io[7:4], want_o[7:4]);
        end
    endtask

    // Uppercase hex with a fixed number of digits (Icarus prints %h lowercase)
    function string HX(input [31:0] v, input integer digits);
        integer i;
        reg [3:0] dg;
        string t;
        begin
            t = "";
            for (i = digits - 1; i >= 0; i = i - 1) begin
                dg = v[i*4 +: 4];
                t = {t, $sformatf("%c", (dg < 10) ? (8'd48 + dg) : (8'd55 + dg))};
            end
            HX = t;
        end
    endfunction

    // ---------------- ./emu runs (each: from reset, <= 8 reply bytes) ----
    string  emu_args, emu_name;
    integer emu_bytes, emu_err0;
    realtime case_start;
    integer cases_run = 0;

    task emu_begin(input string name);
        begin
            case_start = $realtime;
            do_reset;                                  // each case starts from reset
            cases_run = cases_run + 1;
            $display("START %0s", name);
            emu_name = name; emu_args = "-d 0xF0"; emu_bytes = 0; emu_err0 = errors;
        end
    endtask

    // One -t4 command + its -r1/-r4 reply (+ -o if check_o). want is in arrival
    // order (first byte = MSB); ./emu puts the first byte in the LSB.
    task emu_cmd(input [7:0] c, input [7:0] d, input bad_crc, input integer n, input [31:0] want,
                 input check_o, input [7:0] want_o, input [8*48-1:0] what);
        reg [15:0] crc;
        begin
            step(c, d, bad_crc, n, want, check_o, want_o, what);
            crc = crc16(c, d) ^ (bad_crc ? 16'h0001 : 16'h0000);
            emu_args = {emu_args, " -t4 0x", HX({crc, d, c}, 8)};
            if (n == 1) emu_args = {emu_args, " -r1 0x", HX(want[7:0], 2)};
            else        emu_args = {emu_args, " -r4 0x", HX({want[7:0], want[15:8], want[23:16], want[31:24]}, 8)};
            if (check_o) emu_args = {emu_args, " -o 0x", HX(want_o, 2)};
            emu_bytes = emu_bytes + n;
        end
    endtask

    task emu_packet(input [7:0] volts, input [7:0] amps, input [7:0] temp,
                    input bad_crc, input [7:0] want_reply, input [7:0] want_o,
                    input [8*64-1:0] what);
        reg [15:0] crc;
        begin
            sample_step(volts, amps, temp, bad_crc, want_reply, want_o, what);
            crc = sample_crc(volts, amps, temp) ^ (bad_crc ? 16'h1 : 16'h0);
            // Splitting into -t4 and -t2 bypasses the -t6 limitation!
            emu_args = {emu_args, " -t4 0x", HX({temp, amps, volts, CMD_SAMPLE}, 8)};
            emu_args = {emu_args, " -t2 0x", HX({16'd0, crc}, 4)};
            emu_args = {emu_args, " -r1 0x", HX(want_reply, 2)};
            emu_args = {emu_args, " -o 0x", HX(want_o, 2)};
            emu_bytes = emu_bytes + 1;
        end
    endtask

    task emu_sample(input [7:0] volts, input [7:0] amps, input [7:0] temp,
                    input [7:0] want_o, input [8*64-1:0] what);
        begin emu_packet(volts, amps, temp, 0, 8'hA5, want_o, what); end
    endtask

    // -i: drive P3-P0 (P0 = operator reset).
    task emu_in(input [3:0] v);
        begin
            pin_in = v;
            repeat (3000) @(posedge clk);
            emu_args = {emu_args, " -i 0x", HX(v, 2)};
        end
    endtask

    task emu_out(input [7:0] want_o, input [8*48-1:0] what);
        begin
            check(pins_io[7:4] === want_o[7:4], what, pins_io[7:4], want_o[7:4]);
            emu_args = {emu_args, " -o 0x", HX(want_o, 2)};
        end
    endtask

    task emu_end;
        begin
            $display("CASE TIME %0s: %0.0f ns", emu_name, $realtime-case_start);
            check(($realtime-case_start) < 2800000, "case fits short platform budget", $realtime-case_start, 2800000);
            check(emu_bytes <= 8, "emu run within the 8-byte reply limit", emu_bytes, 8);
            if (errors == emu_err0)
                $display("EMU RUN %0s -- verified, %0d of 8 reply bytes:\n  ./emu %0s", emu_name, emu_bytes, emu_args);
            else
                $display("  [FAIL] EMU RUN %0s", emu_name);
        end
    endtask

    task do_reset;
        begin
            rst = 1'b1; pin_in = 4'h0; rx = 1'b1;
            repeat (4) @(posedge clk);
            @(negedge clk) rst = 1'b0;
            repeat (DIVISOR * 2) @(posedge clk);    // boot: DATADIR + state init
        end
    endtask

    initial begin
        $dumpfile("testbench.vcd");
        $dumpvars(0, testbench.rx, testbench.tx, testbench.pins_io);
        if (FIRST_RUN < 1 || LAST_RUN > 12 || FIRST_RUN > LAST_RUN)
            $fatal(1, "Require 1 <= FIRST_RUN <= LAST_RUN <= 12");

            if (FIRST_RUN <= 1 && 1 <= LAST_RUN) begin
                emu_begin("C01 Normal temperature and current");
                emu_sample(230,127,53,8'h00,"26.5 C, 25.4 A: all outputs off");
                emu_cmd('h50,0,0,4,'h40357F00,0,0,"Normal status, zero trips");
                emu_end;
            end
            if (FIRST_RUN <= 2 && 2 <= LAST_RUN) begin
                emu_begin("C02 Warm boundaries (Temp)");
                emu_sample(230,127,54,8'h10,"exact 27 C Warm");
                emu_sample(230,127,64,8'h10,"exact 32 C still Warm");
                emu_cmd('h50,0,0,4,'h41407F00,0,0,"Warm status, no EPO");
                emu_end;
            end
            if (FIRST_RUN <= 3 && 3 <= LAST_RUN) begin
                emu_begin("C03 Temperature Critical");
                emu_sample(230,127,65,8'hA0,"32.5 C: Fan Max + EPO ON");
                emu_cmd('h50,0,0,4,'h4B417F01,0,0,"Critical temperature, EPO on, one trip");
                emu_end;
            end
            if (FIRST_RUN <= 4 && 4 <= LAST_RUN) begin
                emu_begin("C04 Current boundaries");
                emu_sample(230,127,50,8'h00,"25.4 A Normal");
                emu_sample(230,128,50,8'h40,"exact 25.6 A Warning");
                emu_sample(230,160,50,8'h40,"exact 32 A Warning, no EPO");
                emu_end;
            end
            if (FIRST_RUN <= 5 && 5 <= LAST_RUN) begin
                emu_begin("C05 Current Critical");
                emu_sample(230,161,50,8'hC0,"32.2 A: Current warning + EPO ON");
                emu_cmd('h50,0,0,4,'h4C32A101,0,0,"Current Critical, EPO, one trip");
                emu_end;
            end
            if (FIRST_RUN <= 6 && 6 <= LAST_RUN) begin
                emu_begin("C06 Either fault is sufficient");
                emu_sample(230,161,65,8'hE0,"Both Critical -> Fan Max + Warning + EPO");
                emu_sample(230,161,50,8'hC0,"only current Critical -> Warning + EPO");
                emu_sample(230,127,65,8'hA0,"only temperature Critical -> Fan Max + EPO");
                emu_end;
            end
            if (FIRST_RUN <= 7 && 7 <= LAST_RUN) begin
                emu_begin("C07 Both must become Normal");
                emu_sample(230,161,65,8'hE0,"Both Critical -> EPO ON");
                emu_sample(230,128,54,8'hD0,"Temp 27 C / Current 25.6 A -> EPO remains ON");
                emu_sample(230,127,53,8'h80,"Temp 26.5 C / Current 25.4 A -> safe, EPO still latched");
                emu_in(4'h1);
                emu_out(8'h00,"P0 reset -> EPO off");
                emu_in(4'h0);
                emu_end;
            end
            if (FIRST_RUN <= 8 && 8 <= LAST_RUN) begin
                emu_begin("C08 Warm temperature blocks recovery");
                emu_sample(230,127,65,8'hA0,"Temp 32.5 C -> Fan Max + EPO ON");
                emu_sample(230,127,64,8'h90,"Temp 32 C (Warm) -> EPO stays ON");
                emu_sample(230,127,53,8'h80,"Temp 26.5 C (Normal) -> EPO still latched");
                emu_in(4'h1);
                emu_out(8'h00,"P0 reset -> EPO off");
                emu_in(4'h0);
                emu_end;
            end
            if (FIRST_RUN <= 9 && 9 <= LAST_RUN) begin
                emu_begin("C09 Warning current blocks recovery");
                emu_sample(230,161,50,8'hC0,"Current 32.2 A -> Warning + EPO ON");
                emu_sample(230,128,50,8'hC0,"Current 25.6 A (Warning) -> EPO stays ON");
                emu_in(4'h1);
                emu_out(8'hC0,"reset refused: current still Warning");
                emu_in(4'h0);
                emu_sample(230,127,50,8'h80,"Current 25.4 A (Normal) -> EPO still latched");
                emu_in(4'h1);
                emu_out(8'h00,"P0 reset -> EPO off");
                emu_in(4'h0);
                emu_end;
            end
            if (FIRST_RUN <= 10 && 10 <= LAST_RUN) begin
                emu_begin("C10 Invalid packets");
                emu_sample(230,127,65,8'hA0,"Temp Critical -> EPO ON");
                emu_packet(230,127,0,0,8'h3C,8'hA0,"invalid T -> rejected, EPO stays");
                emu_packet(230,127,53,1,8'h5A,8'hA0,"bad CRC -> rejected, EPO stays");
                emu_end;
            end

            if (FIRST_RUN <= 11 && 11 <= LAST_RUN) begin
                emu_begin("C11 P0 reset refused until temperature and current are safe");
                emu_sample(230,127,65,8'hA0,"32.5 C -> Fan Max + EPO ON");
                emu_in(4'h1);
                emu_out(8'hA0,"reset refused: still Critical");
                emu_in(4'h0);
                emu_sample(230,127,54,8'h90,"27 C (Warm) -> EPO latched");
                emu_in(4'h1);
                emu_out(8'h90,"reset refused: still Warm");
                emu_in(4'h0);
                emu_sample(230,127,53,8'h80,"26.5 C, 25.4 A -> safe, EPO latched");
                emu_in(4'h1);
                emu_out(8'h00,"reset accepted");
                emu_in(4'h0);
                emu_end;
            end
            if (FIRST_RUN <= 12 && 12 <= LAST_RUN) begin
                emu_begin("C12 A held P0 button never clears the EPO");
                emu_in(4'h1);
                emu_sample(230,161,50,8'hC0,"32.2 A while P0 is held -> EPO ON");
                emu_sample(230,127,50,8'h80,"safe again, P0 still held -> EPO latched");
                emu_in(4'h0);
                emu_in(4'h1);
                emu_out(8'h00,"a new press resets");
                emu_in(4'h0);
                emu_end;
            end


        $display("tb_dc_teammate: %0d cases, %0d checks, %0d failures", cases_run, checks, errors);
        if(errors==0) $display("tb_dc_teammate PASSED");
        else begin $display("tb_dc_teammate FAILED"); $finish; end
        $finish;
    end
    
    initial begin
        #(BYTE_NS*1000);
        $fatal(1,"testbench watchdog FAILED");
    end
endmodule

