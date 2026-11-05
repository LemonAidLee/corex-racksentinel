module UART #(
    parameter integer CLK_HZ = 25_000_000,
    parameter integer BAUD   = 115_200,
    // 0 (spec): only setting CONTROL.TRANSMIT starts a transmission; writing
    // TXDATA just loads the byte (guide 2.2.1). The kickoff lecture states it
    // as a project rule ("some processors transmit automatically when you
    // write this field -- we're not going to do this"), and the organizer's
    // uart.s sets TRANSMIT after writing TXDATA; the printed 2.3.3 echo omits
    // that step. 1 = also start on a TXDATA write (non-spec, experiments only).
    parameter         TX_ON_TXDATA_WRITE = 0
) (
    input  wire        i_Clk,
    input  wire        i_Rst,

    // bus side (from Address_Decoder)
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data,

    // serial side, 8-N-1
    output wire        o_Tx,
    input  wire        i_Rx
);
    localparam integer DIVISOR = CLK_HZ / BAUD;   // clocks per bit
    localparam integer HALF    = DIVISOR / 2;

    // Word offsets (Block Guide Stage 3, Table 5)
    localparam [9:0] c_TXDATA  = 10'd0,   // 0x0000
                     c_RXDATA  = 10'd1,   // 0x0004
                     c_CONTROL = 10'd2;   // 0x0008

    localparam [2:0] S_IDLE  = 3'd0,
                     S_START = 3'd1,
                     S_DATA  = 3'd2,
                     S_STOP  = 3'd3,
                     S_WAIT  = 3'd4;

    // The two lower address bits are ignored; any other offset is reserved.
    wire [9:0] w_Word      = i_Address[11:2];
    wire       w_WrTxData  = i_We && (w_Word == c_TXDATA);
    wire       w_WrControl = i_We && (w_Word == c_CONTROL);

    // ------------------------------------------------------------------
    // Transmitter
    // ------------------------------------------------------------------
    reg [7:0]  r_TxData;
    reg        r_Transmit;        // CONTROL[0]
    reg        r_TxDataWr;        // TXDATA was written last cycle
    reg        r_TxDone;          // CONTROL[2]
    reg        r_TxBusy;
    reg [9:0]  r_TxFrame;         // {stop, data, start}, shifted out LSB first
    reg [3:0]  r_TxBitsLeft;
    reg [15:0] r_TxCnt;

    wire w_TxStart = !r_TxBusy &&
                     (r_Transmit || (TX_ON_TXDATA_WRITE != 0 && r_TxDataWr));

    assign o_Tx = r_TxBusy ? r_TxFrame[0] : 1'b1;   // line idles high

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_TxData     <= 8'd0;
            r_Transmit   <= 1'b0;
            r_TxDataWr   <= 1'b0;
            // Idle means ready: the §2.3.3 echo polls TXDONE before its first
            // send, so reading 0 out of reset would deadlock it.
            r_TxDone     <= 1'b1;
            r_TxBusy     <= 1'b0;
            r_TxFrame    <= 10'h3FF;
            r_TxBitsLeft <= 4'd0;
            r_TxCnt      <= 16'd0;
        end else begin
            // TRANSMIT self-clears in the cycle after the write (Table 8, note 2).
            r_Transmit <= w_WrControl & i_Data[0];
            r_TxDataWr <= w_WrTxData;
            if (w_WrTxData) r_TxData <= i_Data[7:0];

            if (w_TxStart) begin
                r_TxBusy     <= 1'b1;
                r_TxDone     <= 1'b0;
                r_TxFrame    <= {1'b1, r_TxData, 1'b0};
                r_TxBitsLeft <= 4'd9;
                r_TxCnt      <= DIVISOR - 1;
            end else if (r_TxBusy) begin
                if (r_TxCnt != 0) begin
                    r_TxCnt <= r_TxCnt - 1;
                end else begin
                    r_TxCnt   <= DIVISOR - 1;
                    r_TxFrame <= {1'b1, r_TxFrame[9:1]};
                    if (r_TxBitsLeft == 0) begin
                        r_TxBusy <= 1'b0;
                        r_TxDone <= 1'b1;
                    end else begin
                        r_TxBitsLeft <= r_TxBitsLeft - 1;
                    end
                end
            end
        end
    end

    // ------------------------------------------------------------------
    // Receiver
    // ------------------------------------------------------------------
    reg        r_RxSync1;
    reg        r_RxSync2;
    reg [2:0]  r_RxState;
    reg [15:0] r_RxCnt;
    reg [2:0]  r_RxBit;
    reg [7:0]  r_RxShift;
    reg [7:0]  r_RxData;
    reg        r_RxDone;          // CONTROL[1]

    // A frame is accepted only if its stop bit, sampled mid-bit, is high.
    wire w_RxComplete = (r_RxState == S_STOP) && (r_RxCnt == 0) && r_RxSync2;

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_RxSync1 <= 1'b1;
            r_RxSync2 <= 1'b1;
            r_RxState <= S_IDLE;
            r_RxCnt   <= 16'd0;
            r_RxBit   <= 3'd0;
            r_RxShift <= 8'd0;
            r_RxData  <= 8'd0;
            r_RxDone  <= 1'b0;
        end else begin
            // rx_i is asynchronous to i_Clk, so synchronize before use.
            r_RxSync1 <= i_Rx;
            r_RxSync2 <= r_RxSync1;

            // No oversampling, so each bit is sampled once at its centre:
            // half a bit after the start edge to confirm the start bit, then
            // one full bit period per data bit and for the stop bit.
            case (r_RxState)
                S_IDLE: begin
                    if (!r_RxSync2) begin
                        r_RxState <= S_START;
                        r_RxCnt   <= HALF - 1;
                    end
                end
                S_START: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else if (r_RxSync2) begin
                        r_RxState <= S_IDLE;           // glitch, not a start bit
                    end else begin
                        r_RxState <= S_DATA;
                        r_RxCnt   <= DIVISOR - 1;
                        r_RxBit   <= 3'd0;
                    end
                end
                S_DATA: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else begin
                        r_RxShift <= {r_RxSync2, r_RxShift[7:1]};   // LSB first
                        r_RxCnt   <= DIVISOR - 1;
                        if (r_RxBit == 3'd7) r_RxState <= S_STOP;
                        else                 r_RxBit   <= r_RxBit + 1;
                    end
                end
                S_STOP: begin
                    if (r_RxCnt != 0) begin
                        r_RxCnt <= r_RxCnt - 1;
                    end else if (r_RxSync2) begin
                        r_RxData  <= r_RxShift;
                        r_RxState <= S_IDLE;
                    end else begin
                        // Framing error: drop the byte and wait for the line to
                        // go idle, or the low stop bit would read as a new start.
                        r_RxState <= S_WAIT;
                    end
                end
                S_WAIT: begin
                    if (r_RxSync2) r_RxState <= S_IDLE;
                end
                default: r_RxState <= S_IDLE;
            endcase

            // RXDONE: set by the receiver, cleared by software writing 0.
            // A byte completing in the same cycle wins, so it is never lost.
            if (w_RxComplete)     r_RxDone <= 1'b1;
            else if (w_WrControl) r_RxDone <= i_Data[1];
        end
    end

    // ------------------------------------------------------------------
    // Register reads
    // ------------------------------------------------------------------
    always @(*) begin
        o_Data = 32'd0;
        if (i_Oe) begin
            case (w_Word)
                c_TXDATA:  o_Data = {24'd0, r_TxData};
                c_RXDATA:  o_Data = {24'd0, r_RxData};
                c_CONTROL: o_Data = {29'd0, r_TxDone, r_RxDone, r_Transmit};
                default:   o_Data = 32'd0;
            endcase
        end
    end
endmodule