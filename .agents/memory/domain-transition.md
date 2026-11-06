---
name: Canonical origin
description: Domain transition history and the authoritative site origin
---

Do not continue assuming hwdfarm.com necessarily serves the old site. On 2026-11-06 the user reported that www.hwdfarm.com and hwd-main-site.replit.app still serve this app and requested canonical redirects to APP_ORIGIN, using https://hwdfarm.com as the expected canonical origin in examples.

**Why:** The user's newer hosting information supersedes the earlier pre-DNS-transition assumption. Alias pages can load while exact-origin browser writes are refused.

**How to apply:** Derive site links and SSO origins from APP_ORIGIN, never a remembered hostname. Distinguish requested development changes from deployed production behavior; do not infer that alias redirects are live merely because they were implemented.
