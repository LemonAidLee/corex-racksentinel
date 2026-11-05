"""Exhaustive 1-, 2- and 3-bit error test on the 6-byte SAMPLE packet.
The CRC-16 (poly 0x1021, seed 0xFFFF) covers [0x5A][V][I][T]; the check field is CRC_LO, CRC_HI.
Compared with an 8-bit XOR checksum over the same 4 bytes (+1 check byte)."""
from itertools import combinations
def crc16(bs, r=0xFFFF):
    for b in bs:
        r ^= b << 8
        for _ in range(8):
            r = ((r << 1) ^ 0x1021) & 0xFFFF if r & 0x8000 else (r << 1) & 0xFFFF
    return r
assert crc16(b"123456789") == 0x29B1
def flip(pkt, bits):
    p = bytearray(pkt)
    for k in bits: p[k // 8] ^= 1 << (k % 8)
    return bytes(p)
payload = bytes([0x5A, 230, 127, 65])               # C03: 230 V, 25.4 A, 32.5 C
c = crc16(payload); crc_pkt = payload + bytes([c & 0xFF, c >> 8])
x = 0
for b in payload: x ^= b
xor_pkt = payload + bytes([x])
def crc_ok(p):  return crc16(p[:4]) == p[4] | p[5] << 8
def xor_ok(p):
    y = 0
    for b in p[:4]: y ^= b
    return y == p[4]
for name, pkt, ok in (("CRC-16", crc_pkt, crc_ok), ("XOR-8", xor_pkt, xor_ok)):
    n = len(pkt) * 8; cases = miss = 0
    for e in (1, 2, 3):
        for bits in combinations(range(n), e):
            cases += 1; miss += ok(flip(pkt, bits))
    print(f"{name}: packet {len(pkt)} B, {cases} error patterns, undetected {miss}")
