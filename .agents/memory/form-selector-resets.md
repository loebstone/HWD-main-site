---
name: Form selector resets
description: Required enum selectors inside asynchronously populated admin forms
---

Ignore empty reset events from Radix Select when the form field is a required enum.

Do not run a separate blank-form default effect when a document-specific or filtered default is being applied, even if the selected value still looks empty.

**Why:** A browser walkthrough showed the home-notice visibility becoming an empty string after fetched settings reset the form, despite a valid initial selection. The server correctly refused the resulting request.

An edit dialog also showed a moved document's original group: the reset effect and the first-group fallback both saw the previous empty render, so the fallback overwrote the intended group. Guarding empty Select events alone does not prevent this effect-ordering race.

**How to apply:** Accept only explicit allowed enum values in selector change handlers, especially when React Hook Form is reset from an asynchronous query. Allow first-option fallback only for genuinely blank new forms, never edits or filtered forms. Verify saving without manually changing the selector.
