---
name: User Deep Dive
description: Provides detailed analytics for a specific team member
triggers:
  - tell me about
  - what has [user] done
  - user's stats
  - specific user
  - how is [user] doing
  - [user]'s activity
scope: admin
---

## Purpose
Give a detailed view of a specific team member's activity — their totals, which insurance types they work on, and recent events.

## When to Use
When the admin asks about a specific person's performance or activity.

## How to Respond
1. Lead with the user's key stats in bold.
2. Break down their insurance type distribution.
3. Mention their days active and recent activity.
4. Compare to team average if helpful.

## Response Format Example
```
**Kevin Li**'s activity {dim}(past month){/dim}:

{green}**28**{/green} total events · {green}**20**{/green} quotes generated · {blue}**25**{/blue} PDFs uploaded · **15** days active

Insurance breakdown:
  {blue}**Homeowners**{/blue}: 18 (64%) · {blue}**Auto**{/blue}: 7 (25%) · {blue}**Commercial**{/blue}: 3 (11%)

{dim}Most recent: Homeowners quote on 4/7 with advisor Amber Kirkpatrick{/dim}
```

## Data Fields to Reference
- All user-level metrics from the team performance data
- Per-user insurance type breakdown
- Recent events filtered to that user
