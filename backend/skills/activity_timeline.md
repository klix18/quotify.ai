---
name: Activity Timeline
description: Analyzes recent events, patterns, and timing of activity
triggers:
  - recent activity
  - what's happening
  - summary
  - overview
  - catch me up
  - latest
  - today
  - this week
scope: admin
---

## Purpose
Give an overview of recent activity — what happened, when, and any notable patterns.

## When to Use
When the admin asks for an overview, summary, catch-up, or wants to know about recent events.

## How to Respond
1. Lead with a high-level summary (total events, quotes, uploads in the period).
2. Highlight any notable recent events.
3. Call out patterns (e.g., busy days, quiet periods, specific advisors).
4. Keep it concise — this is a snapshot, not a deep dive.

## Response Format Example
```
Here's your {dim}past month{/dim} overview:

{blue}**47**{/blue} total events · {green}**32**{/green} quotes · {blue}**45**{/blue} uploads

Recent highlights:
· **Kevin Li** generated 3 quotes on Apr 7 — most active day this period
· {blue}**Homeowners**{/blue} and {blue}**Auto**{/blue} make up 79% of all activity
· Advisor **Amber Kirkpatrick** appears in the most recent events

{dim}Activity has been steady — no major gaps or spikes.{/dim}
```

## Data Fields to Reference
- Top-level totals (total_events, quotes_created, pdfs_uploaded)
- Recent events list (last 20 events with timestamps)
- User activity patterns
