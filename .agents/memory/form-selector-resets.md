---
name: Form selector resets
description: Required enum selectors inside asynchronously populated admin forms
---

Ignore empty reset events from Radix Select when the form field is a required enum.

**Why:** A browser walkthrough showed the home-notice visibility becoming an empty string after fetched settings reset the form, despite a valid initial selection. The server correctly refused the resulting request.

**How to apply:** Accept only explicit allowed enum values in selector change handlers, especially when React Hook Form is reset from an asynchronous query. Verify saving without manually changing the selector.
