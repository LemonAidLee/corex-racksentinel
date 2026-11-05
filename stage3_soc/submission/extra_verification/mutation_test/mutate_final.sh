#!/usr/bin/env bash

# Final mutation regression for RackSentinel
# Baseline: final C01-C12 application testbench.
# Mutants are rebuilt using the GNU RISC-V toolchain and
# the organizer-provided RVBL Firmware Builder linker script.
#
# Run from anywhere:  extra_verification/mutation_test/mutate_final.sh
# Requires: iverilog, vvp, python3, riscv64-unknown-elf-{as,gcc,objcopy}
# (override the prefix with TC=riscv32-unknown-elf if needed).

set -u
cd "$(dirname "$0")"

PKG="../.."                                            # submission root
SRC="$PKG/firmware/firmware_application/main.s"        # application source
TB="$PKG/testbench/tb_data_center_application.v"       # C01-C12 testbench
HDL="$PKG/rtl/hdl/hdl_application.v"                   # exported SoC
BUILDER="$PKG/RVBL-Firmware-Builder"                   # organizer linker script
TC="${TC:-riscv64-unknown-elf}"
PY="${PYTHON:-python3}"

W="build/mutants_final"
rm -rf "$W"
mkdir -p "$W"

KILLED=0
SURVIVED=0
INVALID=0

echo "======================================================"
echo " RackSentinel Final Mutation Test"
echo " Final regression: C01-C12"
echo "======================================================"

# ------------------------------------------------------
# Baseline check
# Mutation testing is meaningful only if the unmodified
# design first passes the complete final regression.
# ------------------------------------------------------
echo ""
echo "[BASELINE] Checking unmodified final design..."

if ! iverilog -g2012 \
    -o "$W/baseline.out" \
    "$TB" "$HDL"; then
    echo "[ERROR] Baseline compilation failed."
    exit 1
fi

(
    cd "$W"
    timeout 900 vvp -n baseline.out > baseline.log 2>&1
)

if ! grep -q "tb_dc_teammate PASSED" "$W/baseline.log"; then
    echo "[ERROR] Baseline did not pass. Mutation test aborted."
    tail -n 10 "$W/baseline.log"
    exit 1
fi

BASE_SUMMARY=$(grep "tb_dc_teammate:" "$W/baseline.log" | tail -n 1)
echo "[PASS] Baseline: $BASE_SUMMARY"

# ------------------------------------------------------
# Generate Verilog IMEM directly from GNU-built binary
# ------------------------------------------------------
make_rom() {
    local BIN="$1"
    local ROM="$2"

    "$PY" - "$BIN" "$ROM" <<'PY'
import sys

bin_path = sys.argv[1]
rom_path = sys.argv[2]

data = open(bin_path, "rb").read()

if len(data) % 4:
    data += bytes(4 - len(data) % 4)

with open(rom_path, "w") as f:
    f.write("""module IMEM_Data_Center (
    input  wire [31:0] i_Address,
    input  wire        i_Oe,
    output wire [31:0] o_Data
);
    reg [31:0] r_Instruction;
    assign o_Data = r_Instruction;

    always @(*) begin
        case (i_Address)
""")

    base = 0x00400000

    for i in range(0, len(data), 4):
        word = int.from_bytes(data[i:i+4], "little")
        addr = base + i
        f.write(
            "            32'h%08X: r_Instruction = 32'h%08X;\n"
            % (addr, word)
        )

    f.write("""            default: r_Instruction = 32'h00000000;
        endcase
    end
endmodule
""")
PY
}

# ------------------------------------------------------
# One mutation
# ------------------------------------------------------
mut() {
    NAME="$1"
    SED_EXPR="$2"

    echo ""
    echo "[MUTANT] $NAME"

    sed "$SED_EXPR" "$SRC" > "$W/$NAME.s"

    if cmp -s "$SRC" "$W/$NAME.s"; then
        echo "[INVALID] mutation pattern not found"
        INVALID=$((INVALID + 1))
        return
    fi

    # Assemble
    if ! "$TC-as" \
        -Wall \
        -march=rv32i_zmmul \
        -mabi=ilp32 \
        "$W/$NAME.s" \
        -o "$W/$NAME.o" > "$W/$NAME.lst"; then     # listing to file, errors still on screen

        echo "[INVALID] assembler failed"
        INVALID=$((INVALID + 1))
        return
    fi

    # Link with organizer linker script
    if ! "$TC-gcc" \
        -Wall \
        -march=rv32i_zmmul \
        -mabi=ilp32 \
        -nostdlib \
        -T "$BUILDER/bsp/custom.ld" \
        "$W/$NAME.o" \
        -o "$W/$NAME.elf"; then

        echo "[INVALID] linker failed"
        INVALID=$((INVALID + 1))
        return
    fi

    # Binary
    if ! "$TC-objcopy" \
        -O binary \
        "$W/$NAME.elf" \
        "$W/$NAME.bin"; then

        echo "[INVALID] objcopy failed"
        INVALID=$((INVALID + 1))
        return
    fi

    # Mutant IMEM
    make_rom "$W/$NAME.bin" "$W/${NAME}_rom.v"

    # Replace only the IMEM_Data_Center ROM in the exported HDL
    "$PY" - "$HDL" "$W/${NAME}_rom.v" "$W/${NAME}_design.v" <<'PY'
import re
import sys

hdl = open(sys.argv[1]).read()
rom = open(sys.argv[2]).read()

new_hdl, count = re.subn(
    r"(?ms)^module IMEM_Data_Center\b.*?^endmodule",
    lambda m: rom.strip(),
    hdl
)

if count != 1:
    print("ERROR: expected exactly one IMEM_Data_Center module, found", count)
    sys.exit(1)

open(sys.argv[3], "w").write(new_hdl)
PY

    if [ $? -ne 0 ]; then
        echo "[INVALID] could not replace IMEM module"
        INVALID=$((INVALID + 1))
        return
    fi

    # Compile complete SoC + final C01-C12 testbench
    if ! iverilog -g2012 \
        -o "$W/$NAME.out" \
        "$TB" "$W/${NAME}_design.v"; then

        echo "[INVALID] Verilog compilation failed"
        INVALID=$((INVALID + 1))
        return
    fi

    # Execute
    (
        cd "$W"
        timeout 900 vvp -n "$NAME.out" > "$NAME.log" 2>&1
    )

    SUMMARY=$(grep "tb_dc_teammate:" "$W/$NAME.log" | tail -n 1)

    if grep -q "tb_dc_teammate PASSED" "$W/$NAME.log"; then

        echo "[SURVIVED] $NAME"
        echo "           $SUMMARY"
        SURVIVED=$((SURVIVED + 1))

    elif grep -q "tb_dc_teammate FAILED" "$W/$NAME.log"; then

        FAILURES=$(echo "$SUMMARY" | sed -n 's/.*checks, \([0-9][0-9]*\) failures.*/\1/p')

        echo "[KILLED]   $NAME"
        echo "           $SUMMARY"

        if [ -n "$FAILURES" ]; then
            echo "           detected by $FAILURES failing check(s)"
        fi

        KILLED=$((KILLED + 1))

    else

        echo "[INVALID]  $NAME produced no valid testbench summary"
        tail -n 10 "$W/$NAME.log"
        INVALID=$((INVALID + 1))
    fi
}

# ------------------------------------------------------
# Four safety mutations
# ------------------------------------------------------

mut auto_clear_back \
's/^    j    _sm_update_outputs          # the EPO latches.*$/    lw t0, ST_CLASS(s11)\
    bnez t0, _sm_update_outputs\
    lw t0, ST_WARN_CURRENT(s11)\
    bgeu s4, t0, _sm_update_outputs\
    sw zero, ST_EPO(s11)\
    j _sm_update_outputs/'

mut reset_while_warm \
's/^    bnez t0, _cr_ret                 # temperature not Normal/    nop/'

mut reset_on_warning \
's/^    bgeu t0, t1, _cr_ret             # current at or above.*$/    nop/'

mut level_reset \
's/^    bnez t1, _cr_ret                 # still held.*$/    nop/'

# ------------------------------------------------------
# Final summary
# ------------------------------------------------------

echo ""
echo "======================================================"
echo " Mutation Test Summary"
echo "======================================================"
echo "Killed   : $KILLED"
echo "Survived : $SURVIVED"
echo "Invalid  : $INVALID"

if [ "$KILLED" -eq 4 ] && \
   [ "$SURVIVED" -eq 0 ] && \
   [ "$INVALID" -eq 0 ]; then

    echo "[PASS] Mutation score: 4/4 = 100%"
else
    echo "[FAIL] Mutation campaign did not achieve 4/4 detection"
fi

echo "======================================================"
