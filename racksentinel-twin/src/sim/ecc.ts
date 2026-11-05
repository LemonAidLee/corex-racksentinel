/**
 * SECDED code used by RackSentinel v2 for its safety settings and trip record:
 * Hamming(12,8) plus one overall parity bit, a 13-bit codeword per byte.
 * Bit-for-bit the firmware's ecc_encode / ecc_decode (and the model in stage4_fpga/rack_demo.html).
 *
 * Codeword layout (bit index = Hamming position, bit 0 = overall parity):
 *   positions 1, 2, 4, 8  check bits
 *   positions 3, 5, 6, 7, 9, 10, 11, 12  data bits d0..d7
 */

/** Decode status: 0 clean, 1 one bit corrected, 2 two bits (uncorrectable). */
export type EccStatus = 0 | 1 | 2;

export interface EccDecoded {
  value: number;
  status: EccStatus;
  /** Hamming syndrome (position of the flipped bit for a single error). */
  syndrome: number;
}

function parity(x: number): number {
  x &= 0xffff;
  x ^= x >> 8;
  x ^= x >> 4;
  x ^= x >> 2;
  x ^= x >> 1;
  return x & 1;
}

export function eccEncode(d: number): number {
  let w = ((d & 0x01) << 3) | ((d & 0x0e) << 4) | ((d & 0xf0) << 5);
  w |= parity(w & 0xaa8) << 1;
  w |= parity(w & 0xcc8) << 2;
  w |= parity(w & 0x10e0) << 4;
  w |= parity(w & 0x1e00) << 8;
  return w | parity(w);
}

export function eccDecode(word: number): EccDecoded {
  let w = word;
  const s = parity(w & 0xaaa) | (parity(w & 0xccc) << 1) | (parity(w & 0x10f0) << 2) | (parity(w & 0x1f00) << 3);
  let status: EccStatus = 0;
  if (parity(w & 0x1fff)) {
    status = 1;
    if (s > 12) status = 2; // a syndrome past the last position cannot be a single error
    else w ^= 1 << s; // s = 0 flips the overall parity bit itself
  } else if (s !== 0) {
    status = 2;
  }
  const value = ((w >> 3) & 0x01) | ((w >> 4) & 0x0e) | ((w >> 5) & 0xf0);
  return { value, status, syndrome: s };
}

/** Which codeword bits carry data (the rest are check bits). */
export const ECC_DATA_BITS = [3, 5, 6, 7, 9, 10, 11, 12] as const;
export const ECC_CHECK_BITS = [1, 2, 4, 8] as const;
export const ECC_WIDTH = 13;

/** The two bits FLIP_TEST flips: bit 6 for one flip, bits 6 and 11 for two. */
export const FLIP_ONE = 0x040;
export const FLIP_TWO = 0x840;
