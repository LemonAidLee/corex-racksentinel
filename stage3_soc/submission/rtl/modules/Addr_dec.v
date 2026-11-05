module Addr_dec (
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
 
    // Peripherals are word-access only: they get we/oe but no byte-write mask.
    output wire [31:0] o_gpio_address,
    output wire        o_gpio_we,
    output wire        o_gpio_oe,
    input  wire [31:0] i_gpio_data,

    output wire [31:0] o_uart_address,
    output wire        o_uart_we,
    output wire        o_uart_oe,
    input  wire [31:0] i_uart_data,

    output reg  [31:0] o_core_data
);
    localparam [31:0] IMEM_BASE = 32'h00400000;
    localparam [31:0] DMEM_BASE = 32'h10010000;
    localparam [31:0] IMEM_MASK = 32'hFFC00000;   // 4 MB region
    localparam [31:0] DMEM_MASK = 32'hFFFFE000;   // 8 kB region
    localparam [31:0] GPIO_BASE = 32'hF0000000;
    localparam [31:0] UART_BASE = 32'hF1000000;
    // The guide gives no window size; 4 kB matches the peripherals' [11:2]
    // offset decode, so no address outside the window can alias a register.
    localparam [31:0] PERI_MASK = 32'hFFFFF000;

    // Peripheral selects are continuous assigns, deliberately NOT set inside
    // the always block below. There, `o_x_oe = 0; ... o_x_oe = i_core_oe;`
    // makes o_x_oe glitch every time the block runs; GPIO/UART read data is
    // combinational and gated by oe, so the glitch changes i_x_data, which
    // re-triggers the block: a zero-delay loop that hangs the simulator on
    // the first peripheral load. (DMEM has a registered read, so the DMEM
    // branch below cannot loop.)
    wire w_gpio_sel = ((i_core_address & PERI_MASK) == GPIO_BASE);
    wire w_uart_sel = ((i_core_address & PERI_MASK) == UART_BASE);

    assign o_gpio_address = {i_core_address[31:2], 2'b00};
    assign o_gpio_we      = w_gpio_sel & i_core_we;
    assign o_gpio_oe      = w_gpio_sel & i_core_oe;

    assign o_uart_address = {i_core_address[31:2], 2'b00};
    assign o_uart_we      = w_uart_sel & i_core_we;
    assign o_uart_oe      = w_uart_sel & i_core_oe;
 
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
        else if (w_gpio_sel) begin
            o_core_data = i_gpio_data;
        end
        else if (w_uart_sel) begin
            o_core_data = i_uart_data;
        end
    end
endmodule