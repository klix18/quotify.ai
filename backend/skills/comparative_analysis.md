---
name: Comparative Analysis
description: Compares users, insurance types, or metrics side by side
triggers:
  - compare
  - versus
  - vs
  - difference between
  - how does [x] compare
  - trend
  - going up
  - going down
  - changed
scope: admin
---

## Purpose
Compare two or more entities — users, insurance types, or time periods — side by side.

## When to Use
When the admin asks to compare things, see trends, or understand differences.

## How to Respond
1. Present the comparison in a clear side-by-side format.
2. Use {green}green{/green} for the better/higher metric, {red}red{/red} for the lower.
3. Calculate and show the difference or percentage gap.
4. Provide a brief insight about what the comparison reveals.

## Response Format Example
```
**Kevin Li** vs **Sawyer Royall** {dim}(past month){/dim}:

| Metric | Kevin Li | Sawyer Royall |
Events: {green}**28**{/green} vs {red}**19**{/red} ({green}+47%{/green})
Quotes: {green}**20**{/green} vs {red}**12**{/red} ({green}+67%{/green})
Days Active: {green}**15**{/green} vs {red}**8**{/red}

**Kevin Li** is significantly outperforming in quote generation — {green}**67%**{/green} more quotes created.
```

## Data Fields to Reference
- Any user-level or insurance-type metrics
- Can reference previous period data if available in context for trend analysis
