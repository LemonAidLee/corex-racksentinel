/**
 * Shared byte-level visuals for the explainer pages: a packet as four labelled bytes, a reply,
 * and the GPIO byte as eight pins.
 */
import { CMD_NAME, hex } from "@/sim/protocol";
import { packetText } from "@/sim/timeline";

const ROLE = ["CMD", "DATA", "CRC_LO", "CRC_HI"] as const;

export function PacketBytes({ frame, crcOk = true, size = "md" }: { frame: number[]; crcOk?: boolean; size?: "sm" | "md" }) {
  const meaning = [CMD_NAME[frame[0]] ?? "unknown", packetText(frame[0], frame[1]).replace(/^\S+\s?/, "") || "0", "check", "check"];
  return (
    <ol className={`bytes bytes-${size}`} aria-label={`Packet ${frame.map((b) => hex(b)).join(" ")}`}>
      {frame.map((b, i) => (
        <li key={i} className={`byte byte-${ROLE[i].toLowerCase().replace("_", "-")} ${i >= 2 && !crcOk ? "is-bad" : ""}`} style={{ "--i": i } as React.CSSProperties}>
          <span className="byte-role">{ROLE[i]}</span>
          <span className="byte-hex">{hex(b)}</span>
          <span className="byte-meaning">{meaning[i]}</span>
        </li>
      ))}
    </ol>
  );
}

export function ReplyBytes({ bytes, labels }: { bytes: number[]; labels?: string[] }) {
  return (
    <ol className="bytes bytes-sm" aria-label={`Reply ${bytes.map((b) => hex(b)).join(" ")}`}>
      {bytes.map((b, i) => (
        <li key={i} className="byte byte-reply" style={{ "--i": i } as React.CSSProperties}>
          <span className="byte-role">{labels?.[i] ?? (bytes.length === 1 ? "reply" : `byte ${i}`)}</span>
          <span className="byte-hex">{hex(b)}</span>
        </li>
      ))}
    </ol>
  );
}

const PINS = [
  { bit: 7, name: "P7", role: "Power-off", tone: "critical" },
  { bit: 6, name: "P6", role: "Overload", tone: "warning" },
  { bit: 5, name: "P5", role: "Fans max", tone: "warning" },
  { bit: 4, name: "P4", role: "Fan boost", tone: "warning" },
  { bit: 3, name: "P3", role: "unused", tone: "off" },
  { bit: 2, name: "P2", role: "unused", tone: "off" },
  { bit: 1, name: "P1", role: "Leak in", tone: "critical" },
  { bit: 0, name: "P0", role: "Reset in", tone: "neutral" },
] as const;

/** The GPIO pins as one byte: outputs P7..P4 from `out`, inputs P1..P0 from `inputs`. */
export function PinByte({ out, inputs = 0, compact = false }: { out: number; inputs?: number; compact?: boolean }) {
  return (
    <div className={`pinbyte ${compact ? "is-compact" : ""}`} role="img" aria-label={`Outputs 0x${hex(out & 0xf0)}, inputs 0x${hex(inputs & 0x0f)}`}>
      {PINS.map((p) => {
        const on = !!(((p.bit >= 4 ? out : inputs) >> p.bit) & 1);
        return (
          <span key={p.bit} className={`pin ${on ? `is-on tone-${p.tone}` : ""} ${p.bit < 4 ? "pin-in" : ""}`}>
            <span className="pin-bit">{on ? 1 : 0}</span>
            <span className="pin-name">{p.name}</span>
            {!compact && <span className="pin-role">{p.role}</span>}
          </span>
        );
      })}
    </div>
  );
}
