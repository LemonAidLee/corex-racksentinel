import { crc16 } from "./crc";

/** Command bytes (Documentation/10, main.s .equ table). */
export const CMD = {
  STAGE_HIGH: 0x40,
  SET_WARM: 0x41,
  SET_CRIT: 0x43,
  SET_WARN_CURRENT: 0x46,
  SET_TRIP_CURRENT: 0x48,
  STATUS: 0x50,
  COUNTERS: 0x52,
  SAMPLE: 0x5a,
} as const;

/** Single-byte reply codes. */
export const REPLY = {
  OK: 0xa5,
  INVALID: 0x3c,
  BAD_CRC: 0x5a,
} as const;

/** GPIO output pins P4..P7 as bit masks of the output byte. */
export const PIN = {
  FAN_BOOST: 0x10, // P4
  FAN_MAX: 0x20, // P5
  CURRENT_WARNING: 0x40, // P6
  EPO_REQUEST: 0x80, // P7
} as const;

/** STATUS flag bits (Documentation/10 "STATUS reply"). */
export const STATUS_FLAG = {
  CLASS_MASK: 0x03,
  CURRENT_WARNING: 0x04,
  EPO_LATCHED: 0x08,
  GOT_TEMPERATURE: 0x40,
  STAGE_PENDING: 0x80,
} as const;

const lo = (crc: number) => crc & 0xff;
const hi = (crc: number) => (crc >> 8) & 0xff;

/** 6-byte SAMPLE frame: [0x5A][V][I][T][CRC lo][CRC hi]. CRC covers the first four bytes. */
export function encodeSample(voltRaw: number, currentRaw: number, tempRaw: number, corruptCrc = false): number[] {
  const body = [CMD.SAMPLE, voltRaw & 0xff, currentRaw & 0xff, tempRaw & 0xff];
  // The testbench corrupts a frame by flipping the CRC's low bit; we do the same.
  const crc = crc16(body) ^ (corruptCrc ? 0x0001 : 0);
  return [...body, lo(crc), hi(crc)];
}

/** 4-byte command frame: [CMD][DATA][CRC lo][CRC hi]. CRC covers command and data. */
export function encodeCommand(cmd: number, data: number, corruptCrc = false): number[] {
  const body = [cmd & 0xff, data & 0xff];
  const crc = crc16(body) ^ (corruptCrc ? 0x0001 : 0);
  return [...body, lo(crc), hi(crc)];
}

export const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");
export const hexBytes = (bytes: ArrayLike<number>) => Array.from(bytes, hex).join(" ");

export function replyName(code: number): string {
  switch (code) {
    case REPLY.OK:
      return "Accepted";
    case REPLY.INVALID:
      return "Invalid command or data";
    case REPLY.BAD_CRC:
      return "Bad CRC";
    default:
      return `0x${hex(code)}`;
  }
}
