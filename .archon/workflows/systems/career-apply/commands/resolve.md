# Resolve the application page

The offer was found on an aggregator. You find the page where the employer actually
takes applications, and nothing else: you do not apply, you do not create an account.

## The offer

$INPUTS.offer

Aggregator link: `$INPUTS.link` (platform `$INPUTS.platform`).

## How to proceed

1. Open the aggregator link with your tools (browser if available, otherwise fetch).
   Find the "Apply" control. Three cases:
   - it leads to an external page (an ATS such as Lever, Greenhouse, Ashby, Workable,
     or the company's careers site): follow it once and record the final URL;
   - it is a LinkedIn "Easy Apply" form hosted on LinkedIn: record the LinkedIn job URL
     and set `easy_apply: true`;
   - it asks to apply by e-mail: record the address as `mailto:<address>`.
2. If the posting is closed, removed, or the apply control cannot be found, return an
   empty `apply_url` and say why in `how`.
3. Read only. Do not fill or submit anything.

## Declare

Return exactly:

- `apply_url` — the https URL (or `mailto:`) where the application is deposited; empty
  when not found.
- `easy_apply` — `true` only for a LinkedIn Easy Apply form.
- `how` — one sentence: how you got there, or why you could not.
