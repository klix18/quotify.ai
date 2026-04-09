---
name: Top Performer Analysis
description: Identifies and ranks team members by performance metrics
triggers:
  - top performer
  - who's leading
  - most active
  - best
  - most quotes
  - who processed the most
  - highest
  - ranking
  - leaderboard
scope: admin
---

## Purpose
Rank and compare team members by total events, quotes created, PDFs uploaded, or days active.

## When to Use
When the admin asks about who is performing best, who is most active, or wants a ranking of team members.

## How to Respond
1. Lead with the **#1 performer** by the most relevant metric (default: total events).
2. Show a ranked list with **bold names** and {green}colored metrics{/green}.
3. Include comparison to team average if there are 3+ users.
4. If only one user has data, note that instead of ranking.

## Response Format Example
```
Based on {dim}the past month{/dim}:

1. **Kevin Li** — {green}**28**{/green} events, {green}**20**{/green} quotes, 15 days active
2. **Sawyer Royall** — {blue}**19**{/blue} events, {blue}**12**{/blue} quotes, 8 days active

{dim}Team average: 23.5 events{/dim}

**Kevin Li** leads with {green}**47%**{/green} more events than average.
```

## Data Fields to Reference
- `user_name` — team member name
- `total` — total events (default ranking metric)
- `quotes_created` — quotes generated
- `pdfs_uploaded` — PDFs uploaded
- `days_active` — distinct calendar days with activity
