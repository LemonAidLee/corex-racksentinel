# RackSentinel: specification (v2, final stage)

A data-centre **rack thermal and power guardian** on the RVBL-2 SoC (RV32I + Zmmul + Xicrc,
GPIO and UART); the application lives in the ROM `IMEM_DATA_CENTER`. v1 was the Stage 3
submission (git tag `rack-v1-verified`). v2 (2026-10-08) repurposes the error-correcting code:
it now guards the safety settings and a trip record, where v1 protected a temperature log.

## 1. Context

A controller for one rack in a Johor data hall, generic and not tied to any real operator. It
reads the rack **inlet temperature** and the **feed current** over the UART. It drives the fans,
an overload alarm and an **emergency power-off (EPO)** itself, watches a **water-leak sensor**,
and answers the data-centre management system (DCIM). Temperature classes follow the ASHRAE
thermal guidelines for data centres:

| Class | Inlet | Basis |
|---|---|---|
| Normal | < 27.0 °C | inside the recommended 18–27 °C range |
| Warm | ≥ 27.0 °C | above the recommended range → fan boost |
| Hot | ≥ 32.0 °C | above the class A1 allowable maximum → fans at maximum |
| Critical | ≥ 35.0 °C | above the class A2 allowable maximum → EPO |

## 2. Pins

| Pin | Dir | Meaning |
|---|---|---|
| P4 | out | Fan boost (Warm) |
| P5 | out | Fans at maximum (Hot or Critical) |
| P6 | out | Power overload / load-shed alarm |
| P7 | out | **EPO** (latched) |
| P0 | in | Operator reset (acts on a new press only) |
| P1 | in | Water-leak sensor (1 = water) |

`./emu -o` values: Normal 0x00, Warm 0x10, Hot 0x20, Critical 0xA0 (fans max + EPO), plus 0x40
for an overload and 0x80 while the EPO is latched.

## 3. Packet protocol

`[CMD][DATA][CRC_LO][CRC_HI]`, CRC-16-CCITT (0x1021, seed 0xFFFF) over CMD and DATA, computed
with `crcb`. Emulator form: `-t4 0x{CRC}{DATA}{CMD}`. Replies: 0xA5 accepted, 0x5A bad CRC
(nothing executed, counted), 0x3C invalid, or data. Bytes 2–4 of a packet time out after 1.0 s
at 250 MHz (`./emu` spaces them at least 100 ms apart); a timed-out fragment is dropped
without a reply.

## 4. Commands

| CMD | Name | DATA | Reply | Effect |
|---|---|---|---|---|
| 0x20 | TEMP | raw 1–254 (0.5 °C) | A5 / 3C | class; runaway; EPO; all four temperature settings checked |
| 0x21 | CURRENT | raw 0–254 (0.2 A) | A5 / 3C | power = V × I (`mul`, 0.2 W units); overload; energy += power; voltage and limit checked |
| 0x31 | FLIP_TEST | bits 3:0 protected word 0–8, bit 4 = two flips | A5 / 3C | built-in self-test: flips 1 or 2 bits of a protected word |
| 0x41–0x43 | SET_WARM / SET_HOT / SET_CRIT | raw 1–254 (0.5 °C) | A5 / 3C | one command each; committed only if Warm < Hot < Critical |
| 0x44 | SET_RISE | raw units, 0 = off | A5 | runaway limit (default 4 = 2.0 °C per reading) |
| 0x45 | SET_VOLTAGE | 180–254 V | A5 / 3C | default 230 V |
| 0x46 | SET_POWER_LIMIT | 1–254 × 100 W | A5 / 3C | default 59 = 5.9 kW (80 % of a 32 A / 230 V feed) |
| 0x50 | STATUS | 0 | 4 bytes | flags, temperature raw, current raw, EPO trips |
| 0x51 | ENERGY | 0 | 4 bytes | energy in Wh, least-significant byte first |
| 0x52 | COUNTERS | 0 | 4 bytes | CRC rejects, ECC corrected, ECC uncorrectable, 0 |
| 0x53 | TRIP_INFO | 0 | 4 bytes | cause, temperature raw and current raw of the trip that latched the EPO, EPO trips |

Removed since v1: 0x30 FETCH_LOG and 0x40 STAGE_HIGH (both reply 0x3C).

STATUS flags: bits 1:0 class, bit 2 overload, bit 3 EPO latched, bit 4 leak now, bit 5 runaway
on the latest reading, bit 6 a temperature received, bit 7 **config fault** (a setting is
unreadable). Trip causes (bit mask): 0x01 Critical temperature, 0x02 thermal runaway, 0x04
leak, 0x08 config fault. Counters saturate at 255.

## 5. Behaviour

- **Class:** the highest threshold that the temperature reaches or exceeds. A reading exactly on
  a threshold takes the higher class. Thresholds are held in the sensor's 0.5 °C units
  (defaults 54 / 64 / 70).
- **Runaway:** `raw − previous raw ≥ limit`, only when a previous reading exists. A falling
  temperature never counts as a runaway.
- **EPO trips** on Critical, a runaway, a leak (P1, polled while idle, so it needs no UART
  traffic) or a config fault. The EPO pin is driven first; the record is written after. It
  **latches**. A new press of P0 clears it only when every cause is gone: not Critical, no
  runaway on the latest reading, no leak, no setting in fault. A held or stuck button never
  clears it. Each 0→1 transition counts one trip.
- **Latch encoding:** the latch word is all ones when set, and any non-zero value counts as
  latched, so no single flipped bit can unlatch it.
- **Protected words:** the six settings (Warm, Hot, Critical, runaway limit, voltage, power
  limit) and the three trip-record bytes are each stored as a Hamming(12,8) + overall-parity
  (SECDED) codeword. A setting is decoded **every time it is used**:
  - one flipped bit → corrected, the word rewritten (scrubbed), the corrected counter +1;
  - two flipped bits → the setting reads as 0, its fault bit is set, the uncorrectable counter
    +1 (once), and the reading that found it **trips the EPO** with cause config. The fault
    clears only when the management system rewrites that setting with its SET command.
  - An unreadable trip-record byte reads as 0xFF in TRIP_INFO; it never blocks a reset.
- **Trip record:** written at the moment the EPO latches (first cause only), kept after a
  reset until the next trip.
- **Power:** `P = V × I_raw` in 0.2 W units. The overload flag is set when P ≥ limit × 500 and
  follows the latest reading (it does not latch).
- **Energy:** one CURRENT reading per minute, so E grows by P each reading, in 0.2 W·min units,
  and saturates at 0xFFFFFFFF. **Wh = E / 300**, computed as `mulhu(E, 0xDA740DA8) >> 8`; exact
  for all 2³² values of E (checked exhaustively in C), because Zmmul has no divider.
- **Boot** (2,949 cycles): settings 54 / 64 / 70, runaway limit 4, 230 V, 5.9 kW, stored as
  codewords; everything else 0, outputs off.

## 6. Verification

- **`tb_soc_rack.v`:** 16 scenarios and 9 emulator runs, 524 checks, on the local SoC and on the
  8-pin canvas design.
- **`mutate.sh`:** 23 realistic firmware bugs; the testbench catches all 23.
- **`tb_platform_rack.v`:** the 9 runs, one per ChipInventor batch (1.2–2.7 ms each).
- **`emu_runs.txt`:** the verified `./emu` lines, replayable with `emu.sh --all`.
