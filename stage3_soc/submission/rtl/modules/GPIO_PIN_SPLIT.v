module GPIO_PIN_SPLIT (
    input  wire [7:0] i_Pins_Out,   // from GPIO.o_Pins_Out (DATAOUT)
    input  wire [7:0] i_Pins_Oe,    // from GPIO.o_Pins_Oe  (DATADIR, 1 = output)
    output wire [7:0] o_Pins_In,    // to   GPIO.i_Pins_In

    // to Inout Pin k: C (value driven) and D (direction, 1 = output)
    output wire       o_C0, o_C1, o_C2, o_C3, o_C4, o_C5, o_C6, o_C7,
    output wire       o_D0, o_D1, o_D2, o_D3, o_D4, o_D5, o_D6, o_D7,

    // from Inout Pin k: the pin itself
    input  wire       i_P0, i_P1, i_P2, i_P3, i_P4, i_P5, i_P6, i_P7
);
    assign {o_C7, o_C6, o_C5, o_C4, o_C3, o_C2, o_C1, o_C0} = i_Pins_Out;
    assign {o_D7, o_D6, o_D5, o_D4, o_D3, o_D2, o_D1, o_D0} = i_Pins_Oe;
    assign o_Pins_In = {i_P7, i_P6, i_P5, i_P4, i_P3, i_P2, i_P1, i_P0};
endmodule