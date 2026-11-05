"""Build the official-test-firmware variant of the V2 ChipInventor export.

Only the instruction ROM changes: the case body of IMEM_Data_Center in
stage3_design-2026.09.29_ver2/design/rtl/top.v is replaced by the organizer's
RVBL-GPIO-UART-Test-Firmware/src/firmware.txt (21 words). Every other line of
the export is copied unchanged.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[1] / "stage3_design-2026.09.29_ver2" / "design" / "rtl" / "top.v"
FW = HERE / "official_firmware.txt"
OUT = HERE / "top_testfw.v"

design = SRC.read_text()
words = re.findall(r"32'h([0-9A-Fa-f]{8}): r_Instruction = 32'h([0-9A-Fa-f]{8});", FW.read_text())
assert len(words) == 21, len(words)
body = "".join(f"            32'h{a}: r_Instruction = 32'h{w};\n" for a, w in words)

pat = re.compile(r"(module IMEM_Data_Center \(.*?case \(i_Address\)\n)(.*?)(\s*default: r_Instruction)", re.S)
m = pat.search(design)
assert m, "IMEM_Data_Center case body not found"
old = len(re.findall(r"r_Instruction = 32'h", m.group(2)))
design = design[:m.start(2)] + body + design[m.end(2):]
OUT.write_text(design)

# Confirm: the new ROM holds exactly the organizer's words, and nothing else changed.
rom = re.search(r"module IMEM_Data_Center.*?endmodule", design, re.S).group(0)
got = re.findall(r"32'h([0-9A-Fa-f]{8}): r_Instruction = 32'h([0-9A-Fa-f]{8});", rom)
print(f"application ROM words replaced: {old}")
print(f"official ROM words: {len(got)} -> {'IDENTICAL to firmware.txt' if got == words else 'DIFFERENT'}")
strip = lambda s: re.sub(r"module IMEM_Data_Center.*?endmodule", "", s, flags=re.S)
print("rest of the export:", "unchanged" if strip(design) == strip(SRC.read_text()) else "CHANGED")
