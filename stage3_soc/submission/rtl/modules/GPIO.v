module GPIO (
    input  wire        i_Clk,
    input  wire        i_Rst,

    // bus side (from Address_Decoder)
    input  wire [31:0] i_Address,
    input  wire        i_We,
    input  wire        i_Oe,
    input  wire [31:0] i_Data,
    output reg  [31:0] o_Data,

    // pin side: split tristate, collapsed to inout pins_io at the top level
    output wire [7:0]  o_Pins_Out,
    output wire [7:0]  o_Pins_Oe,
    input  wire [7:0]  i_Pins_In
);
    // Word offsets (Block Guide Stage 3, Table 1)
    localparam [9:0] c_DATAOUT = 10'd0,   // 0x0000
                     c_DATAIN  = 10'd1,   // 0x0004
                     c_DATADIR = 10'd2;   // 0x0008

    reg [7:0] r_DataOut;
    reg [7:0] r_DataIn;
    reg [7:0] r_DataDir;
    reg [7:0] r_Sync1;
    reg [7:0] r_Sync2;

    // The two lower address bits are ignored; any other offset is reserved.
    wire [9:0] w_Word = i_Address[11:2];

    assign o_Pins_Out = r_DataOut;
    assign o_Pins_Oe  = r_DataDir;

    always @(posedge i_Clk) begin
        if (i_Rst) begin
            r_DataOut <= 8'd0;
            r_DataDir <= 8'd0;      // all inputs: nothing driven out of reset
            r_DataIn  <= 8'd0;
            r_Sync1   <= 8'd0;
            r_Sync2   <= 8'd0;
        end else begin
            // Pins are asynchronous to i_Clk, so synchronize before sampling.
            r_Sync1 <= i_Pins_In;
            r_Sync2 <= r_Sync1;
            // Guide §1.3.1: in output mode the input buffer is isolated, so a
            // pin's DATAIN bit holds instead of sampling its own driven value.
            r_DataIn <= (r_DataIn & r_DataDir) | (r_Sync2 & ~r_DataDir);

            if (i_We) begin
                case (w_Word)
                    c_DATAOUT: r_DataOut <= i_Data[7:0];
                    c_DATADIR: r_DataDir <= i_Data[7:0];
                    default: ;  // DATAIN is read-only; reserved offsets ignored
                endcase
            end
        end
    end

    always @(*) begin
        o_Data = 32'd0;
        if (i_Oe) begin
            case (w_Word)
                c_DATAOUT: o_Data = {24'd0, r_DataOut};
                c_DATAIN:  o_Data = {24'd0, r_DataIn};
                c_DATADIR: o_Data = {24'd0, r_DataDir};
                default:   o_Data = 32'd0;
            endcase
        end
    end
endmodule