---
name: Domain transition
description: Production origin before the family domain moves to the new site
---

Until DNS moves, the new production site is https://hwd-main-site.replit.app and hwdfarm.com points at the old site.

**Why:** The user explicitly clarified this deployment transition.

**How to apply:** Default links back to this site must derive from APP_ORIGIN, not assume hwdfarm.com already serves the new site. Explicit admin overrides remain allowed. Confirm the transition has happened before treating hwdfarm.com as the new production origin.
