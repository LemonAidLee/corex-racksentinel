# 06 · SoC and memory map

> [!NOTE]
> **After this chapter you will know**
> Every block in the final design, how they connect, the address of everything, and what happens on a typical instruction fetch, GPIO write and UART read.

## The real diagrams

This is the ChipInventor canvas of the SoC (Stage 3). Stage 4 uses the same canvas with the v2 ROM `IMEM_DATA_CENTER`.

![Full system block diagram](attachments/Full_Block_Diagram.png)

And the peripheral side (GPIO, the pin splitter, eight pins, UART):

![Peripheral block diagram](attachments/Peripheral_Block_Diagram.png)

## The same thing, simplified

```mermaid
flowchart TB
    subgraph CORE ["CPU core (Stage 2)"]
        CU["Control Unit<br/>4-state FSM"]
        PC["PC Unit"]
        RF["Register File"]
        ALU["ALU"]
        MUL["MULT Unit<br/>Zmmul"]
        CRC["CRC16 Unit<br/>Xicrc"]
        BR["Branch Comparator"]
        IMM["Immediate Generator"]
        DM["Datapath Mux"]
        LSU["LSU"]
    end
    DEC{"Address Decoder"}
    subgraph MEMS ["Memories"]
        IMEM["IMEM ROM<br/>firmware"]
        DMEM["DMEM RAM 8 kB"]
    end
    subgraph PERI ["Stage 3 peripherals"]
        GPIO["GPIO"]
        SPLIT["GPIO PIN SPLIT"]
        UART["UART"]
    end
    PINS["8 Inout pins P0-P7"]
    SER["rx_i and tx_o"]

    LSU --> DEC
    DEC --> IMEM
    DEC --> DMEM
    DEC --> GPIO
    DEC --> UART
    GPIO --> SPLIT --> PINS
    UART --> SER
    CU --> PC
    classDef core fill:#1f6feb,stroke:#0b3d91,color:#fff
    classDef dec fill:#9a6700,stroke:#633c01,color:#fff
    classDef mem fill:#8250df,stroke:#4c2889,color:#fff
    classDef per fill:#2da44e,stroke:#116329,color:#fff
    classDef ext fill:#cf222e,stroke:#82071e,color:#fff
    class CU,PC,RF,ALU,MUL,CRC,BR,IMM,DM,LSU core
    class DEC dec
    class IMEM,DMEM mem
    class GPIO,SPLIT,UART per
    class PINS,SER ext
```

> [!NOTE]
> **Colour key**
> Blue = CPU core · Orange = address decoder · Purple = memories · Green = peripherals · Red = the outside world.

## Top-level ports of the chip (`top`)

| Port | Direction | Purpose |
|---|---|---|
| `clk_i` | in | The clock: 25 MHz in simulation; on the AWS FPGA a wrapper divides 250 MHz by 8 to 31.25 MHz |
| `rst_i` | in | Reset |
| `rx_i` | in | Serial receive (messages **into** the chip) |
| `tx_o` | out | Serial transmit (replies **out of** the chip) |
| `pins_io_0` ... `pins_io_7` | in/out | The eight GPIO pins P0..P7 |
| `o_PC`, `o_State`, `o_RD_We` | out | Debug views of the CPU, handy in waveforms |

> [!TIP]
> **Why eight separate pins?**
> ChipInventor's pin blocks are **one bit each**, so the design exposes eight scalar ports instead of one 8-bit bus. The little block **GPIO_PIN_SPLIT** slices the GPIO's 8-bit buses into per-pin wires. See [08](08-gpio.md).

## The memory map

| Block | Starts at | Size of window | Access | What lives there |
|---|---|---|---|---|
| **IMEM** | `0x0040_0000` | 4 MB window | read only | The firmware (CPU starts here after reset) |
| **DMEM** | `0x1001_0000` | 8 kB | read and write | Application variables |
| **GPIO** | `0xF000_0000` | 4 kB window | word access | 3 registers |
| **UART** | `0xF100_0000` | 4 kB window | word access | 3 registers |

```mermaid
flowchart LR
    A["0x0040_0000<br/>IMEM firmware"] --- B["0x1001_0000<br/>DMEM data"] --- C["0xF000_0000<br/>GPIO"] --- D["0xF100_0000<br/>UART"]
    classDef a fill:#8250df,stroke:#4c2889,color:#fff
    classDef b fill:#bf8700,stroke:#7d4e00,color:#fff
    classDef c fill:#2da44e,stroke:#116329,color:#fff
    classDef d fill:#1f6feb,stroke:#0b3d91,color:#fff
    class A a
    class B b
    class C c
    class D d
```

### Peripheral registers at a glance

| Peripheral | Offset | Register | Meaning |
|---|---|---|---|
| GPIO | `+0x0` | DATAOUT | Value driven onto output pins |
| GPIO | `+0x4` | DATAIN | Value read from input pins |
| GPIO | `+0x8` | DATADIR | Direction per pin: **0 = input, 1 = output** |
| UART | `+0x0` | TXDATA | Byte to send |
| UART | `+0x4` | RXDATA | Last byte received |
| UART | `+0x8` | CONTROL | Flags: bit0 TRANSMIT, bit1 RXDONE, bit2 TXDONE |

> [!CAUTION]
> **Direction convention**
> `DATADIR` bit = **1 means output**. If you guess the opposite, the pins will do nothing and the bug will be hard to spot. RackSentinel writes `0xF0`: P7..P4 are outputs, P3..P0 are inputs.

## Three journeys through the chip

### Fetching an instruction

```mermaid
sequenceDiagram
    participant PC as PC Unit
    participant D as Decoder
    participant I as IMEM
    participant IR as Instruction Register
    PC->>D: address 0x0040_xxxx
    D->>I: read enable
    I-->>D: 32-bit instruction
    D-->>IR: latched at end of FETCH
```

### Writing a GPIO pin (`sw t2, 0(s0)`)

```mermaid
sequenceDiagram
    participant CPU
    participant D as Decoder
    participant G as GPIO
    participant P as Pins
    CPU->>D: store to 0xF000_0000
    D->>G: write enable, offset 0
    G->>G: DATAOUT register updated
    G->>P: drive the pins whose DATADIR bit is 1
```

### Reading the UART (`lw t0, 8(s1)`)

```mermaid
sequenceDiagram
    participant CPU
    participant D as Decoder
    participant U as UART
    CPU->>D: load from 0xF100_0008
    D->>U: read enable, offset 8
    U-->>D: flags TXDONE, RXDONE, TRANSMIT
    D-->>CPU: value returned to register
```

> [!WARNING]
> **A subtle simulator hazard the decoder avoids**
> GPIO and UART read data is *combinational* (changes the instant the read-enable changes). If the decoder had set the peripheral enables inside the same `always` block that also reads their data, the simulator could loop forever on the first peripheral load. Final design drives the selects with plain continuous `assign` statements to avoid it. DMEM does not have the problem because its read is clocked.

## Unmapped addresses

An address outside all four windows reads as **0** and writes go nowhere. The 4 kB peripheral windows are exactly as big as the registers' address decode, so no stray address can *alias* (accidentally hit) a register.

Next: [07 Module reference](07-module-reference.md)
