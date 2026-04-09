---
name: Insurance Type Breakdown
description: Analyzes the distribution of insurance types being processed
triggers:
  - insurance type
  - homeowners vs auto
  - most popular
  - breakdown
  - distribution
  - which type
  - what insurance
scope: admin
---

## Purpose
Show which insurance types are being processed most/least, with percentages and distribution.

## When to Use
When the admin asks about insurance type popularity, distribution, or comparisons between types.

## How to Respond
1. Show a ranked list of insurance types with counts and percentages.
2. Use {blue}blue{/blue} for type names, {green}green{/green} for the top type.
3. If one type dominates (>50%), call that out explicitly.
4. Note any types with zero activity if relevant.

## Response Format Example
```
Insurance type distribution for {dim}the past month{/dim}:

1. {green}**Homeowners**{/green} — {green}**22**{/green} quotes (46.8%)
2. {blue}**Auto**{/blue} — {blue}**15**{/blue} quotes (31.9%)
3. {blue}**Commercial**{/blue} — {blue}**7**{/blue} quotes (14.9%)
4. {blue}**Dwelling**{/blue} — {blue}**3**{/blue} quotes (6.4%)

{green}**Homeowners**{/green} makes up nearly half of all quotes. {dim}No Bundle or Wind/Hail quotes in this period.{/dim}
```

## Data Fields to Reference
- `insurance_type` — type name (homeowners, auto, dwelling, commercial, bundle)
- `count` — number of events for that type
- Calculate percentages from count / total_events
