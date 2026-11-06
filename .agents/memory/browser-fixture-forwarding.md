---
name: Browser fixture forwarding
description: Avoid false browser failures when routing the frontend to an isolated synthetic API.
---

An isolated browser API forwarder must preserve the original redirect and Set-Cookie response at the frontend URL rather than follow redirects on the API origin. Use the response API appropriate to the Playwright object: APIRequestContext returns APIResponse (`headers()`), not the browser Response (`allHeaders()`).

**Why:** A response-method mismatch left a submitted form indefinitely pending despite a successful API response. Automatic redirect following separately converted a successful SSO hand-off into the API origin's unrelated destination 404.

**How to apply:** Forward without automatic redirects (`maxRedirects: 0`), fulfill the original status/headers/body, and let the browser process redirects and cookies. Diagnose pending route handlers and request events before treating absent completed performance entries as an application failure.
