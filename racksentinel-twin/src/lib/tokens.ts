/**
 * Colour tokens shared by canvas-drawn UI art (scenario icons) and mirrored in globals.css.
 * Green, amber and red are reserved for real controller states; steel blue is the neutral
 * interface / data accent.
 */
export const STATE = {
  normal: 0x3fb950,
  warning: 0xe3a51b,
  critical: 0xe5484d,
  off: 0x6f7882,
} as const;

export const NEUTRAL = {
  outline: 0x0b0e12,
  white: 0xe9edf1,
  steel: 0x9aa4ae,
  steelDark: 0x5d6670,
  graphite: 0x2a3038,
  data: 0x6fa8dc, // neutral data / cooling blue
} as const;

export type StateTone = "normal" | "warning" | "critical" | "neutral";
