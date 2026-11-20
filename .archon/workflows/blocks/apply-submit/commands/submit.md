# Submit (apply-submit)

The form at `$INPUTS.apply_url` (platform `$INPUTS.platform`) was filled by the previous
agent and checked; the policy or the candidate has said go. You send it, once, and you
prove it.

This step may be run more than once for the same application: after a provider error the
engine starts it again from the beginning, in a new session. A second click can send a
duplicate application. The files below are how you know whether a click was already
attempted.

## How to proceed

0. **Before anything else, check for an earlier attempt.** Look for
   `$ARTIFACTS_DIR/$INPUTS.out_dir/click.json` and
   `$ARTIFACTS_DIR/$INPUTS.out_dir/receipt.json` (use Glob or Read; do not open the browser
   yet).
   - If either file exists, a click was already attempted for this application. **Do not
     click anything, do not reload or navigate the page, do not fill anything.** Do not
     write or change any file. Return `clicked: false` and a `summary` that starts with
     "A click was already attempted" and names the file(s) you found.
   - Only if neither file exists, go on.
1. Take a snapshot of the current tab. It must be the filled form described in
   `$ARTIFACTS_DIR/$INPUTS.out_dir/prefill.json` (same `final_url`, same fields). Fields that
   prefill left empty ("à remplir par Antoine") may have been filled by Antoine at the go:
   that is expected, leave them as they are.
   - Its host must be one of `$INPUTS.hosts`, or a subdomain of one (`x.<host>`), over
     `https://`. If it is not (another site, a look-alike such as `<host>.evil.com`, `http://`),
     do not click: write `receipt.json` with `submitted: false`, `clicked_url: ""` and
     `error: "host not allowed: <host>"`, and return `clicked: false`.
   - If the tab already shows a confirmation ("thank you for applying", "application
     received"…), the form was sent before this step: do not click anything. Take the
     screenshot (step 5), write `receipt.json` with `submitted: true`, the confirmation
     text, and `error: "already submitted before the submit step"`, and return
     `clicked: false`.
   - If the tab is gone or the form is empty, do not refill it: write `receipt.json` with
     `submitted: false` and `error: "form lost before submit"`, and return `clicked: false`.
2. **Immediately before clicking**, write `$ARTIFACTS_DIR/$INPUTS.out_dir/click.json`:
   `{ "at": "<ISO timestamp>", "control": "<the submit control you are about to click>", "url": "<the URL of the current tab>" }`.
   Write it first, then click: never click without having written it. If you cannot write
   it, do not click; return `clicked: false` and say why.
3. Click the final submit control named in `prefill.json`. **Click it once.** Never click
   it a second time, even if the page seems slow: a second click can send a duplicate.
4. Wait for the page to settle (up to 30 seconds). Read the resulting page: a
   confirmation message, a new URL, a confirmation e-mail notice. Copy the exact
   confirmation sentence when there is one.
5. Take a full-page screenshot to `$ARTIFACTS_DIR/$INPUTS.out_dir/receipt.png`.
6. If an error or a validation message appears instead of a confirmation, copy it
   verbatim into `error`; do not correct the form and retry. The human will.

## Write `$ARTIFACTS_DIR/$INPUTS.out_dir/receipt.json`

```json
{
  "submitted": true,
  "clicked_at": "<ISO timestamp>",
  "clicked_url": "<URL of the page where you clicked, as in click.json; empty if you did not click>",
  "final_url": "<URL after submission>",
  "confirmation_text": "<the exact confirmation sentence, or empty>",
  "page_excerpt": "<the first 1,500 characters of the visible page text>",
  "screenshot": "receipt.png",
  "error": ""
}
```

## Declare

Return exactly:

- `summary` — one or two sentences: what happened after the click, or why you did not
  click (starting with "A click was already attempted" in the case of step 0).
- `clicked` — `true` when you clicked the submit control in this session.
