> EXTENDS: homeowners
> CARRIER: sagesure

# SageSure — Homeowners Overrides

This patch extends the base homeowners skill. Only deviations are listed below.

## Layout Overrides
- SageSure places through multiple admitted carriers. Ignore any underlying carrier
  name in small print — treat the document as SageSure.
- Premium is in **"Quote Summary"** on the last page. Use **"Annual Premium"**, NOT
  "Total Policy Cost" (which includes optional fees and installment charges).
- **"Property Information"** section always shows: construction_type, year_built,
  protection_class, roof_shape, roof_material.

## Label Overrides
- "Sinkhole" deductible may appear in FL policies
- "Replacement Cost Value" annotation next to Coverage C → contents are on RC basis

## Common Endorsements
- "Screened Enclosure" → sublimit for screened lanais/pools
- "Law & Ordinance" → percentage (10% / 25%)
- "Equipment Breakdown Protection"
- "Water Backup and Sump Overflow" → sublimit
