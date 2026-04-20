> EXTENDS: dwelling
> CARRIER: ncjua

# NCJUA / FAIR Plan — Dwelling Overrides

This patch extends the base dwelling skill. Only deviations are listed below.

## Layout Overrides
- Simple text layout, NOT a table. Coverages listed as plain text lines:
  "A - Dwelling $X", "B - Other Structures $X", etc.
- Single deductible line: **"Deductible: All Perils $X"** → `aop_deductible`
- Policy form labeled **"Policy Form:"** as plain text.
- Premium is the total shown at the bottom of the quote, no separate premium breakdown.
