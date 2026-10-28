---
name: Session test clocks
description: Keep long session-expiry simulations from invalidating unrelated test fixtures.
---

Tests that advance time through the three-day Roster-outage grace should inject a test-local clock instead of changing the suite-wide clock.

**Why:** Shared-clock jumps age every authenticated fixture, which can make later tests fail for unrelated session-expiry reasons.

**How to apply:** Use the suite clock for short, sequential time tests; give long outage and grace-period scenarios their own clock provider.
