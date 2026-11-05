#!/usr/bin/env bash
# Rebuild figures and the report. Usage: ./build.sh [figs]
set -u
cd "$(dirname "$0")"
if [ "${1:-}" = "figs" ]; then
  python figures/src/wave.py
  (cd figures/src && for f in fig01_concept fig02_architecture fig06_firmware_flow fig07_validation_matrix; do
     lualatex -interaction=nonstopmode -halt-on-error "$f.tex" > /dev/null 2>&1 || echo "FIGURE FAILED: $f"
     cp "$f.pdf" ..
   done)
fi
lualatex -interaction=nonstopmode -jobname=Stage_3_Report_v2 main > /dev/null 2>&1
bibtex Stage_3_Report_v2 > /dev/null 2>&1
lualatex -interaction=nonstopmode -jobname=Stage_3_Report_v2 main > /dev/null 2>&1
lualatex -interaction=nonstopmode -jobname=Stage_3_Report_v2 main > /dev/null 2>&1
grep -E "^!|Output written|Overfull|undefined|Warning: (Reference|Citation)" Stage_3_Report_v2.log | sort | uniq -c
