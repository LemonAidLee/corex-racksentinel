# Glossary

> [!NOTE]
> **Every term, once**
> Alphabetical. Each entry says what it is and where it matters.

| Term | Meaning | See |
|---|---|---|
| **8-N-1** | Serial format: 8 data bits, No parity, 1 stop bit | [09](09-uart.md) |
| **AFI / AGFI** | Amazon FPGA Image ID and its global ID; the AGFI is what you load onto the FPGA | [03](03-fpga-and-demo.md) |
| **ASHRAE** | The body whose data-centre thermal guidelines set the v2 limits 27 / 32 / 35 °C | [02](02-rules-and-protocol.md) |
| **Address decoder** | Block that looks at an address and picks memory or a peripheral | [06](06-soc-and-memory-map.md) |
| **Alias** | Two addresses accidentally hitting the same register | [06](06-soc-and-memory-map.md) |
| **ALU** | Arithmetic Logic Unit: add, subtract, logic, shifts | [07](07-module-reference.md) |
| **Assembly** | Human-readable form of machine instructions | [10](10-firmware.md) |
| **Baud** | Bits per second on a serial line (here 115,200) | [09](09-uart.md) |
| **Bit / byte / word** | 1 bit / 8 bits / 32 bits | [04](04-digital-basics.md) |
| **Branch** | Instruction that may jump depending on a comparison | [05](05-the-cpu.md) |
| **Bus** | A group of wires carrying a multi-bit value | [06](06-soc-and-memory-map.md) |
| **ChipInventor** | The online tool where blocks are wired into a SoC | [12](12-build-and-reproduce.md) |
| **Clock** | The steady tick that drives sequential logic (25 MHz in simulation; 31.25 MHz on the AWS FPGA) | [04](04-digital-basics.md) |
| **Clock divider** | Logic that makes a slower clock from a faster one; 250 MHz ÷ 8 on the FPGA | [03](03-fpga-and-demo.md) |
| **Config fault** | v2: a setting with a 2-bit ECC error; trips the EPO until the setting is rewritten | [02](02-rules-and-protocol.md) |
| **Combinational** | Logic whose output depends only on current inputs | [04](04-digital-basics.md) |
| **Control Unit** | The FSM that runs FETCH, DECODE, EXECUTE, WRITEBACK | [05](05-the-cpu.md) |
| **CRC / CRC-16** | Strong checksum; here polynomial `0x1021`, start `0xFFFF` | [02](02-rules-and-protocol.md) |
| **`crcb`** | Custom instruction: feed one byte into a CRC | [05](05-the-cpu.md) |
| **DATADIR / DATAIN / DATAOUT** | The three GPIO registers | [08](08-gpio.md) |
| **DCIM** | Data Centre Infrastructure Management: the supervisory system | [01](01-racksentinel.md) |
| **DRC / LVS** | Design Rule Check (layout obeys the factory's rules) / Layout Versus Schematic (layout matches the netlist) | [05](05-the-cpu.md) |
| **DMEM** | Data memory (RAM), 8 kB at `0x1001_0000` | [06](06-soc-and-memory-map.md) |
| **ECC** | Error-Correcting Code: extra bits that let stored data be checked and repaired | [02](02-rules-and-protocol.md) |
| **Edge detection** | Noticing the **change** 0 to 1, not the level | [10](10-firmware.md) |
| **`./emu`** | The organisers' emulator program that drives the chip's pins and UART on the AWS FPGA | [03](03-fpga-and-demo.md) |
| **Energy (Wh)** | v2: power added up per reading (one reading = one minute), returned by `ENERGY` | [02](02-rules-and-protocol.md) |
| **EPO** | Emergency Power-Off | [01](01-racksentinel.md) |
| **Firmware** | The program stored in the chip's ROM | [10](10-firmware.md) |
| **FPGA** | Reprogrammable chip used to try out a design in hardware; v2 runs on one in the AWS cloud | [03](03-fpga-and-demo.md) |
| **FLIP_TEST** | v2 self-test command that flips 1 or 2 bits of a stored setting to show ECC working | [02](02-rules-and-protocol.md) |
| **GDSII** | The final layout file sent to a chip factory | [05](05-the-cpu.md) |
| **Hamming code** | An ECC that can locate and fix a single flipped bit | [02](02-rules-and-protocol.md) |
| **FSM** | Finite-State Machine: one state at a time, steps on the clock | [04](04-digital-basics.md) |
| **GPIO** | General-Purpose Input/Output pins | [08](08-gpio.md) |
| **High-impedance (Z)** | A disconnected pin driver | [08](08-gpio.md) |
| **Hex** | Base-16 notation, `0x...` | [04](04-digital-basics.md) |
| **IMEM** | Instruction memory (ROM) at `0x0040_0000` | [06](06-soc-and-memory-map.md) |
| **Immediate** | A constant stored inside an instruction | [07](07-module-reference.md) |
| **Inout Pin** | ChipInventor block for a bidirectional pin | [08](08-gpio.md) |
| **Latch (EPO)** | State that stays on until a specific reset | [01](01-racksentinel.md) |
| **LSB** | Least significant bit (sent first on UART) | [09](09-uart.md) |
| **LSU** | Load/Store Unit | [07](07-module-reference.md) |
| **Memory-mapped I/O** | Peripherals accessed like memory addresses | [04](04-digital-basics.md) |
| **Metastability** | Garbled value when sampling a changing signal | [08](08-gpio.md) |
| **`mul`** | Multiply instruction (Zmmul) | [05](05-the-cpu.md) |
| **`mulhu`** | Multiply and keep the upper 32 bits (Zmmul); v2 uses it to divide energy by 300 | [02](02-rules-and-protocol.md) |
| **Multicycle** | A CPU that reuses one datapath over several clock ticks per instruction (ours: 4) | [05](05-the-cpu.md) |
| **Mutation testing** | Plant bugs to prove tests catch them | [11](11-verification.md) |
| **OpenLane** | Open-source flow that turns Verilog into a chip layout (GDSII) | [05](05-the-cpu.md) |
| **P0 to P7** | The eight GPIO pins | [08](08-gpio.md) |
| **PC** | Program Counter: address of the next instruction | [05](05-the-cpu.md) |
| **Polling** | Repeatedly checking a flag until it changes | [09](09-uart.md) |
| **RackSentinel** | The application: rack guardian | [01](01-racksentinel.md) |
| **RAM / ROM** | Read-write memory / read-only memory | [04](04-digital-basics.md) |
| **Register** | A small stored value inside a block or the CPU | [04](04-digital-basics.md) |
| **Reset** | Forces a known starting state | [04](04-digital-basics.md) |
| **RISC-V** | Open instruction-set family | [05](05-the-cpu.md) |
| **RTL** | Register-Transfer Level: the Verilog description of the hardware | [07](07-module-reference.md) |
| **RV32I** | 32-bit base RISC-V instruction set (37 instructions) | [05](05-the-cpu.md) |
| **RVBL-2** | Our processor SoC | [00](00-start-here.md) |
| **SAMPLE** | The 6-byte telemetry packet (v1 only; removed in v2) | [14](14-project-journey.md) |
| **Scrub** | Writing a corrected value back to memory after ECC repairs it | [02](02-rules-and-protocol.md) |
| **SECDED** | Single-Error-Correct, Double-Error-Detect: Hamming code plus one overall parity bit | [02](02-rules-and-protocol.md) |
| **Sequential** | Logic with memory, changes on the clock | [04](04-digital-basics.md) |
| **sky130** | SkyWater's open 130 nm manufacturing process, used for the Stage 2 OpenLane run | [05](05-the-cpu.md) |
| **SoC** | System on a Chip | [00](00-start-here.md) |
| **Synchroniser** | Two flip-flops that safely import an outside signal | [08](08-gpio.md) |
| **Testbench** | A pretend world that drives and checks the design | [11](11-verification.md) |
| **Thermal runaway** | v2: a temperature rise between two readings at or above the limit (2.0 °C), taken as a cooling failure | [02](02-rules-and-protocol.md) |
| **Trip record / TRIP_INFO** | v2: the cause, temperature and current saved when the EPO latched | [02](02-rules-and-protocol.md) |
| **Tri-state** | A pin that can drive 0, 1 or be disconnected | [08](08-gpio.md) |
| **UART** | Serial port | [09](09-uart.md) |
| **v1 / v2** | RackSentinel firmware versions: v1 submitted in Stage 3 (simulation); v2 runs on the FPGA in Stage 4 | [14](14-project-journey.md) |
| **Verilog** | Language describing hardware | [07](07-module-reference.md) |
| **Vivado** | AMD/Xilinx tool that synthesises and places the design for the FPGA | [03](03-fpga-and-demo.md) |
| **WNS / WHS** | Worst Negative Slack (setup) / Worst Hold Slack; positive means timing is met | [03](03-fpga-and-demo.md) |
| **Xicrc** | Our custom CRC instruction extension (3 instructions) | [05](05-the-cpu.md) |
| **Zmmul** | RISC-V multiply-only extension (4 instructions) | [05](05-the-cpu.md) |

---
[Back to index](README.md)
