"""Draw Figures 5(b) and 8(b) from the VCD files of the local Icarus runs.

  fig05b_official_wave.pdf  <- sim/testfw.vcd     (tb_official_testfw.v)
  fig08a_c11_wave.pdf       <- sim/final/app_final12.vcd (final 12-case tb_dc_teammate.v, case C11)

Every edge and every decoded UART byte comes from the VCD; nothing is typed in.
"""
import os
import re
from pathlib import Path

import matplotlib
matplotlib.use("pdf")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Polygon, Rectangle

ROOT = Path(__file__).resolve().parents[2]
SIM = ROOT / "sim"
OUT = ROOT / "figures"
PLEX = Path(os.environ.get("PLEX_DIR", "fonts/opentype/ibm/plex"))  # set PLEX_DIR to your IBM Plex font folder
for f in ("IBMPlexSans-Regular.otf", "IBMPlexSans-SemiBold.otf", "IBMPlexMono-Regular.otf",
          "IBMPlexSansCondensed-Regular.otf"):
    font_manager.fontManager.addfont(str(PLEX / f))
plt.rcParams.update({"font.family": "IBM Plex Sans", "font.size": 6.4, "pdf.fonttype": 42})

NAVY, RIVER, TEAL, AMBER, ALARM = "#15304B", "#2A6FA8", "#1E8573", "#C9821A", "#B5382C"
MIST, HAIR, SLATE, INK = "#EEF2F6", "#B7C2CD", "#5E6B78", "#24292F"
BIT_NS = 217 * 40  # 8680 ns per bit at 115200 baud, 25 MHz


def read_vcd(path):
    """Return {name: [(t_ns, value_str), ...]} for every scalar/vector signal."""
    ids, sig, t = {}, {}, 0
    scale = 1e-3  # ps -> ns (Icarus writes 1ps timescale for these benches)
    text = path.read_text()
    m = re.search(r"\$timescale\s+(\d+)\s*(\w+)", text)
    if m:
        scale = int(m.group(1)) * {"ps": 1e-3, "ns": 1.0, "us": 1e3}[m.group(2)]
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("$var"):
            p = line.split()
            ids.setdefault(p[3], []).append(p[4])
            for n in ids[p[3]]:
                sig.setdefault(n, [])
        elif line.startswith("#"):
            t = int(line[1:]) * scale
        elif line and line[0] in "01xzXZ" and len(line) > 1 and line[1:] in ids:
            for n in ids[line[1:]]:
                sig[n].append((t, line[0]))
        elif line.startswith("b"):
            v, i = line[1:].split()
            for n in ids.get(i, []):
                sig[n].append((t, v))
    return sig


def value_at(trace, t):
    v = trace[0][1]
    for tt, vv in trace:
        if tt > t:
            break
        v = vv
    return v


def uart_bytes(trace, t0, t1):
    """Decode 8-N-1 frames from a 1-bit trace: [(t_start, byte), ...]."""
    out, t = [], t0
    falls = [tt for (tt, v), (_, pv) in zip(trace[1:], trace[:-1]) if v == "0" and pv == "1"]
    busy_until = -1
    for f in falls:
        if f < t0 or f > t1 or f < busy_until:
            continue
        b = 0
        for k in range(8):
            if value_at(trace, f + BIT_NS * (1.5 + k)) == "1":
                b |= 1 << k
        out.append((f, b))
        busy_until = f + BIT_NS * 9.5
    return out


def bus_segments(trace, t0, t1, fmt):
    segs, cur_t, cur_v = [], t0, value_at(trace, t0)
    for tt, vv in trace:
        if t0 < tt < t1 and vv != cur_v:
            segs.append((cur_t, tt, cur_v))
            cur_t, cur_v = tt, vv
    segs.append((cur_t, t1, cur_v))
    merged = []  # merge neighbours that show the same value (e.g. only P0 changed)
    for a, b, v in segs:
        lab = fmt(v)
        if merged and merged[-1][2] == lab:
            merged[-1] = (merged[-1][0], b, lab)
        else:
            merged.append((a, b, lab))
    return merged


def draw_bit(ax, y, trace, t0, t1, color, h=0.55):
    xs, ys = [t0], [y + h * (value_at(trace, t0) == "1")]
    for tt, vv in trace:
        if t0 < tt < t1:
            xs += [tt, tt]
            ys += [ys[-1], y + h * (vv == "1")]
    xs.append(t1)
    ys.append(ys[-1])
    ax.plot(xs, ys, color=color, lw=0.8, solid_joinstyle="miter")


def draw_bus(ax, y, segs, h=0.55, fills=None, min_label=0):
    d = (segs[-1][1] - segs[0][0]) * 0.004
    for a, b, lab in segs:
        fc = (fills or {}).get(lab, "white")
        pts = [(a, y + h / 2), (a + d, y + h), (b - d, y + h), (b, y + h / 2), (b - d, y), (a + d, y)]
        ax.add_patch(Polygon(pts, closed=True, fc=fc, ec=NAVY, lw=0.6))
        if b - a > min_label:
            ax.text((a + b) / 2, y + h / 2, lab, ha="center", va="center", fontsize=6.2,
                    family="IBM Plex Mono", color=INK)


def frame(ax, rows, t0, t1, ticks, unit_scale, unit):
    ax.set_xlim(t0, t1)
    ax.set_ylim(-0.35, len(rows) + 0.05)
    ax.set_yticks([len(rows) - 1 - i + 0.27 for i in range(len(rows))])
    ax.set_yticklabels(rows, fontsize=6.4, color=NAVY)
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{(x - t0) / unit_scale:g} {unit}" for x in ticks], fontsize=5.8, color=SLATE)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(HAIR)
    ax.tick_params(axis="y", length=0)
    ax.tick_params(axis="x", colors=HAIR, length=2)
    for x in ticks:
        ax.axvline(x, color=MIST, lw=0.5, zorder=0)


def byte_labels(ax, y, frames, color, fmt="0x{:02X}"):
    for f, b in frames:
        ax.text(f + BIT_NS * 5, y + 0.78, fmt.format(b), ha="center", va="center",
                fontsize=5.6, family="IBM Plex Mono", color=color, fontweight="semibold")


def fig5b():
    s = read_vcd(SIM / "testfw.vcd")
    t0, t1 = 0.0, max(t for tr in s.values() for t, _ in tr)   # last VCD timestamp ($finish)
    rows = ["clk 25 MHz", "rst", "P3–P0 (in)", "P7–P4 (out)", "rx (in)", "tx (out)"]
    fig, ax = plt.subplots(figsize=(4.25, 1.85))
    n = len(rows) - 1
    cycles = sum(1 for _, v in s["clk"] if v == "1")
    ax.add_patch(Rectangle((t0, n + 0.05), t1 - t0, 0.45, fc=MIST, ec=HAIR, lw=0.4))
    ax.text((t0 + t1) / 2, n + 0.27, f"{cycles:,} clock cycles", ha="center", va="center",
            fontsize=5.8, color=SLATE)
    draw_bit(ax, n - 1, s["rst"], t0, t1, NAVY)
    hexfmt = lambda v: "Z" if "z" in v.lower() else "x" if "x" in v.lower() else f"0x{int(v, 2):X}"
    draw_bus(ax, n - 2, bus_segments(s["pin_in"], t0, t1, hexfmt))
    draw_bus(ax, n - 3, bus_segments(s["p_out"], t0, t1, hexfmt), min_label=15000)
    draw_bit(ax, n - 4, s["rx"], t0, t1, RIVER)
    draw_bit(ax, n - 5, s["tx"], t0, t1, TEAL)
    byte_labels(ax, n - 4, uart_bytes(s["rx"], t0, t1), RIVER)
    byte_labels(ax, n - 5, uart_bytes(s["tx"], t0, t1), TEAL)
    frame(ax, rows, t0, t1, [t0 + k * 100000 for k in range(int((t1 - t0) // 100000) + 1)], 1000, "µs")
    fig.tight_layout(pad=0.2)
    fig.savefig(OUT / "fig05b_official_wave.pdf")
    print("fig05b:", cycles, "cycles,", round(t1 / 1000), "us")


def fig8b():
    s = read_vcd(SIM / "final" / "app_final12.vcd")
    log = (SIM / "final" / "app_final12.log").read_text()
    # each case starts where the previous one ended, so C11 starts at sum(C01..C10)
    times = [int(ns) for _, ns in re.findall(r"CASE TIME (C\d\d)[^:]*: (\d+) ns", log)]
    t0 = float(sum(times[:10]))
    t1 = t0 + times[10]
    pins = "pins_io"
    trace = s[pins] if pins in s else s["pins_io [7:0]"]

    def nib(v, hi):
        v = v.rjust(8, "0")
        bits = v[:4] if hi else v[4:]
        return "x" if any(c in "xz" for c in bits) else f"0x{int(bits, 2):X}0" if hi else f"{int(bits, 2)}"

    out = bus_segments(trace, t0, t1, lambda v: nib(v, True))
    p0 = [(t, v.rjust(8, "0")[-1]) for t, v in trace]
    rows = ["P0 reset (in)", "P7–P4 (out)", "rx (in)", "tx (out)"]
    fig, ax = plt.subplots(figsize=(7.1, 1.45))
    n = len(rows) - 1
    draw_bit(ax, n, p0, t0, t1, NAVY)
    fills = {"0xA0": "#F4D9D5", "0x90": "#F4D9D5", "0x80": "#F4D9D5", "0x00": "#DCEFEA"}
    draw_bus(ax, n - 1, [seg for seg in out], fills=fills, min_label=30000)
    draw_bit(ax, n - 2, s["rx"], t0, t1, RIVER)
    draw_bit(ax, n - 3, s["tx"], t0, t1, TEAL)
    byte_labels(ax, n - 3, uart_bytes(s["tx"], t0, t1), TEAL)
    # one label per 6-byte sample packet instead of per byte
    rxb = uart_bytes(s["rx"], t0, t1)
    for i in range(0, len(rxb) - 5, 6):
        f, _ = rxb[i]
        v, a, tmp = rxb[i + 1][1], rxb[i + 2][1], rxb[i + 3][1]
        ax.text((f + rxb[i + 5][0]) / 2 + BIT_NS * 5, n - 2 + 0.8,
                f"5A  {v} V · {a * 0.2:.1f} A · {tmp * 0.5:.1f} °C", ha="center", va="center",
                fontsize=5.6, color=RIVER, fontweight="semibold")
    # mark each P0 press with its outcome
    presses = [t for (t, v), (_, pv) in zip(p0[1:], p0[:-1]) if t0 < t < t1 and v == "1" and pv == "0"]
    for t in presses:
        after = nib(value_at(trace, t + 100000), True)
        ok = after == "0x00"
        ax.text(t, n + 0.8, "accepted" if ok else "refused", ha="left", va="center", fontsize=5.6,
                color=TEAL if ok else ALARM, fontweight="semibold")
    frame(ax, rows, t0, t1, [t0 + k * 500000 for k in range(int((t1 - t0) // 500000) + 1)], 1e6, "ms")
    fig.tight_layout(pad=0.2)
    fig.savefig(OUT / "fig08a_c11_wave.pdf")
    print("fig08b: C11 window", t0, t1, "presses", len(presses), "rx bytes", len(rxb))


if __name__ == "__main__":
    # Fig 5 now uses the ChipInventor platform screenshots; fig5b() is kept for local reruns.
    fig8b()
