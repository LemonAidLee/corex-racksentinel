import { crc16 } from "./crc";

/**
 * RackSentinel v2 protocol (stage4_fpga/SPEC.md §3–4). Every message is four bytes:
 * [CMD][DATA][CRC_LO][CRC_HI], CRC-16-CCITT over CMD and DATA.
 */
export const CMD = {
  TEMP: 0x20,
  CURRENT: 0x21,
  FLIP_TEST: 0x31,
  SET_WARM: 0x41,
  SET_HOT: 0x42,
  SET_CRIT: 0x43,
  SET_RISE: 0x44,
  SET_VOLTAGE: 0x45,
  SET_POWER_LIMIT: 0x46,
  STATUS: 0x50,
  ENERGY: 0x51,
  COUNTERS: 0x52,
  TRIP_INFO: 0x53,
} as const;

export const CMD_NAME: Record<number, string> = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));

/** Single-byte reply codes. */
export const REPLY = {
  OK: 0xa5,
  INVALID: 0x3c,
  BAD_CRC: 0x5a,
} as const;

/** GPIO output pins P4..P7 as bit masks of the output byte. */
export const PIN = {
  FAN_BOOST: 0x10, // P4: Warm
  FAN_MAX: 0x20, // P5: Hot or Critical
  OVERLOAD: 0x40, // P6: power at or above the limit
  EPO: 0x80, // P7: emergency power-off, latched
} as const;

/** GPIO input pins. */
export const INPUT = {
  RESET: 0x01, // P0
  LEAK: 0x02, // P1
} as const;

/** STATUS flag bits (SPEC §4). */
export const STATUS_FLAG = {
  CLASS_MASK: 0x03,
  OVERLOAD: 0x04,
  EPO_LATCHED: 0x08,
  LEAK: 0x10,
  RUNAWAY: 0x20,
  GOT_TEMPERATURE: 0x40,
  CONFIG_FAULT: 0x80,
} as const;

/** Trip causes, as a bit mask (TRIP_INFO byte 0). */
export const CAUSE = {
  CRITICAL: 0x01,
  RUNAWAY: 0x02,
  LEAK: 0x04,
  CONFIG: 0x08,
} as const;

export const CAUSE_TEXT: [number, string][] = [
  [CAUSE.CRITICAL, "Critical temperature"],
  [CAUSE.RUNAWAY, "thermal runaway"],
  [CAUSE.LEAK, "water leak"],
  [CAUSE.CONFIG, "unreadable setting"],
];

export function causeText(c: number): string {
  const parts = CAUSE_TEXT.filter(([bit]) => c & bit).map(([, t]) => t);
  return parts.length ? parts.join(" + ") : "none";
}

const lo = (crc: number) => crc & 0xff;
const hi = (crc: number) => (crc >> 8) & 0xff;

/** 4-byte frame. `corruptData` XORs the DATA byte in transit after the CRC was computed. */
export function encodeCommand(cmd: number, data: number, corruptData = 0): number[] {
  const crc = crc16([cmd & 0xff, data & 0xff]);
  return [cmd & 0xff, (data ^ corruptData) & 0xff, lo(crc), hi(crc)];
}

/** The 32-bit value `./emu -t4` sends for a frame (least-significant byte goes out first). */
export function frameValue(frame: number[]): number {
  return ((frame[3] << 24) | (frame[2] << 16) | (frame[1] << 8) | frame[0]) >>> 0;
}

/** Reply bytes as the 32-bit value `./emu -r4` compares (first byte least significant). */
export function replyValue(bytes: number[]): number {
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = ((v << 8) | bytes[i]) >>> 0;
  return v;
}

export const hex = (b: number, n = 2) => (b >>> 0).toString(16).toUpperCase().padStart(n, "0");
export const hexBytes = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => hex(b)).join(" ");

export function replyName(code: number): string {
  switch (code) {
    case REPLY.OK:
      return "Accepted";
    case REPLY.INVALID:
      return "Invalid command or value";
    case REPLY.BAD_CRC:
      return "Bad CRC";
    default:
      return `0x${hex(code)}`;
  }
}
