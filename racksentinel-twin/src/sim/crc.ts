/**
 * CRC-16/CCITT as used by RackSentinel: polynomial 0x1021, initial value 0xFFFF,
 * MSB-first, no reflection, no final XOR. Mirrors the hardware `crcb` instruction
 * applied byte by byte in firmware/firmware_application/main.s.
 */
export const CRC_INIT = 0xffff;
export const CRC_POLY = 0x1021;

/** Fold one byte into a running CRC (what one `crcb` instruction does). */
export function crcByte(crc: number, byte: number): number {
  let r = (crc ^ ((byte & 0xff) << 8)) & 0xffff;
  for (let i = 0; i < 8; i++) {
    r = r & 0x8000 ? ((r << 1) ^ CRC_POLY) & 0xffff : (r << 1) & 0xffff;
  }
  return r;
}

export function crc16(bytes: ArrayLike<number>): number {
  let crc = CRC_INIT;
  for (let i = 0; i < bytes.length; i++) crc = crcByte(crc, bytes[i]);
  return crc;
}
