---
name: Role switch boundaries
description: Why effective-role changes require discarding mounted UI observers, not only clearing cached queries
---

Effective-role changes must discard the old mounted private UI, not only clear the query cache.

**Why:** A phone browser test showed a correct server-side member role and banner while Home still displayed the previous admin's tool cards. Clearing React Query removed cached queries but mounted observers retained their old data.

**How to apply:** Keep a full private-UI reset at role changes. The current deliberate boundary is cancelling queries, clearing the cache, and replacing the document with Home. Do not replace it with a soft navigation/cache-clear alone without testing both privilege reduction and restoration with existing mounted queries.
