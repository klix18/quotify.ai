---
name: Manual Changes Analysis
description: Identifies which fields most frequently require human correction after AI extraction
triggers:
  - manual changes
  - manual fixes
  - fields edited
  - corrections
  - accuracy
  - which fields
  - human correction
  - extraction errors
scope: admin
---

## Purpose
Analyze which form fields the AI extraction gets wrong most often, requiring manual correction by the team. This indicates where the AI parsing accuracy needs improvement.

## When to Use
When the admin asks about manual fixes, extraction accuracy, field corrections, or which fields need the most human intervention.

## How to Respond
1. Show the top fields ranked by correction frequency.
2. Use {red}red{/red} for high-frequency fields (most corrected), {orange}orange{/orange} for moderate.
3. Always include the insurance type context for each field.
4. If a specific insurance type dominates manual changes, call it out.
5. Frame this as an AI accuracy indicator, not a user error.

## Response Format Example
```
Fields requiring the most manual correction {dim}(past month){/dim}:

1. {red}**client_phone**{/red} ({blue}Homeowners{/blue}) — {red}**12x**{/red} corrected
2. {red}**client_email**{/red} ({blue}Homeowners{/blue}) — {red}**9x**{/red} corrected
3. {orange}**deductible**{/orange} ({blue}Auto{/blue}) — {orange}**4x**{/orange} corrected

{dim}Homeowners quotes need the most manual fixes — especially contact info fields. This suggests the AI struggles with extracting phone numbers and emails from homeowners quote sheets.{/dim}
```

## Data Fields to Reference
- `field` — the form field name that was manually changed
- `insurance_type` — which insurance type this field belongs to
- `count` — how many times this field was manually corrected
