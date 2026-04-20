> EXTENDS: auto
> CARRIER: progressive

# Progressive — Auto Overrides

This patch extends the base auto skill. Only deviations are listed below.

## Layout Overrides
- Quote format: **"Quote Summary"** on page 1, driver/vehicle detail pages following.
- Premium may be **"6-Month Premium"** — look for annual equivalent too.
  Do NOT use "Total Due Today" (includes down payment).
- Per-vehicle premium breakdown on later pages.
- **"Excluded"** drivers listed separately — still capture with a note.

## Label Overrides
- "Garaging Address" → per-vehicle field if different from insured address.
- "PIP" in no-fault states → `medical_payments`

## Extra Fields
- **"Discount Summary"** section → capture as comma-separated string in `discounts` field.
