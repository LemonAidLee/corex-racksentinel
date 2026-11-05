#!/usr/bin/env python3
from itertools import combinations

POLY = 0x1021
INIT = 0xFFFF

def crc16(data):
    r = INIT
    for byte in data:
        r ^= byte << 8
        for _ in range(8):
            if r & 0x8000:
                r = ((r << 1) ^ POLY) & 0xFFFF
            else:
                r = (r << 1) & 0xFFFF
    return r

def xor8(data):
    x = 0
    for byte in data:
        x ^= byte
    return x

def flip_bits(packet, positions):
    p = bytearray(packet)
    for bit in positions:
        byte_i = bit // 8
        bit_i = 7 - (bit % 8)
        p[byte_i] ^= 1 << bit_i
    return bytes(p)

# ---------------------------------------------------------
# Standard CRC-16/CCITT-FALSE check vector
# ---------------------------------------------------------
check = crc16(b"123456789")
print("CRC-16/CCITT check '123456789' = 0x%04X" % check)
print("Expected                         = 0x29B1")
print("[PASS]" if check == 0x29B1 else "[FAIL]")
print()

# ---------------------------------------------------------
# Final RackSentinel SAMPLE example:
# CMD_SAMPLE=0x5A, V=230, I=127 (25.4 A), T=53 (26.5 C)
# Firmware/testbench protect these four bytes.
# Wire sends CRC low byte then high byte.
# ---------------------------------------------------------
payload = bytes([0x5A, 230, 127, 53])
crc = crc16(payload)

crc_packet = payload + bytes([crc & 0xFF, crc >> 8])

print("RackSentinel SAMPLE payload =", payload.hex(" ").upper())
print("CRC16                      = 0x%04X" % crc)
print("48-bit transmitted packet  =", crc_packet.hex(" ").upper())
print()

crc_total = 0
crc_missed = 0
crc_by_weight = {}

for weight in (1, 2, 3):
    tested = 0
    missed = 0

    for bits in combinations(range(48), weight):
        corrupted = flip_bits(crc_packet, bits)

        corrupted_payload = corrupted[:4]
        received_crc = corrupted[4] | (corrupted[5] << 8)

        tested += 1

        if crc16(corrupted_payload) == received_crc:
            missed += 1

    crc_by_weight[weight] = (tested, missed)
    crc_total += tested
    crc_missed += missed

# ---------------------------------------------------------
# Comparison: simple 8-bit XOR checksum
# Payload 4 bytes + checksum 1 byte = 40-bit packet.
# ---------------------------------------------------------
checksum = xor8(payload)
xor_packet = payload + bytes([checksum])

xor_total = 0
xor_missed = 0
xor_by_weight = {}

for weight in (1, 2, 3):
    tested = 0
    missed = 0

    for bits in combinations(range(40), weight):
        corrupted = flip_bits(xor_packet, bits)

        corrupted_payload = corrupted[:4]
        received_checksum = corrupted[4]

        tested += 1

        if xor8(corrupted_payload) == received_checksum:
            missed += 1

    xor_by_weight[weight] = (tested, missed)
    xor_total += tested
    xor_missed += missed

print("==============================================")
print(" CRC-16 EXHAUSTIVE ERROR-INJECTION TEST")
print("==============================================")
for w in (1, 2, 3):
    tested, missed = crc_by_weight[w]
    print(f"{w}-bit errors : {tested:5d} tested, {missed} missed")

print("----------------------------------------------")
print(f"Total patterns : {crc_total}")
print(f"CRC missed     : {crc_missed}")
print()

print("==============================================")
print(" 8-BIT XOR CHECKSUM COMPARISON")
print("==============================================")
for w in (1, 2, 3):
    tested, missed = xor_by_weight[w]
    print(f"{w}-bit errors : {tested:5d} tested, {missed} missed")

print("----------------------------------------------")
print(f"Total patterns : {xor_total}")
print(f"XOR missed     : {xor_missed}")
print()

if (
    check == 0x29B1
    and crc_total == 18472
    and crc_missed == 0
    and xor_total == 10700
    and xor_missed == 80
):
    print("[PASS] CRC verification completed successfully.")
else:
    print("[FAIL] Result differs from expected values.")
