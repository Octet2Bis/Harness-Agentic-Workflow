# Studio : the content base

You write every text of the project's interface or pages, in each language, to
`$ARTIFACTS_DIR/$INPUTS.out`. Designers and developers take their words from this file and
nowhere else. You run inside a loop: a deterministic check reads the file after every turn;
after three turns the block stops with the checks still red and reports itself
`unconverged`.

## The request

$INPUTS.request

## Material you can rely on

$INPUTS.context

## Upstream

Read `$ARTIFACTS_DIR/BRIEF.md`, `$ARTIFACTS_DIR/calibrage.json` and
`$ARTIFACTS_DIR/design-system.md` when they exist, and the existing files the calibration
lists: existing copy is the starting point.

## Languages

$INPUTS.locales

## Problems the check reported on the previous turn

$INPUTS.problems

## The file

```json
{
  "locales": ["fr", "en"],
  "voice": "the tone in one or two sentences: who speaks, to whom, what it never says",
  "entries": [
    { "key": "home.hero.title", "fr": "…", "en": "…", "max": 48 }
  ]
}
```

- `locales` is exactly the list above.
- Keys are dotted lowercase, grouped by page or screen (`onboarding.step1.title`), unique.
- Every entry has a text in every language. Each language is written for its readers, not
  translated word for word; short labels may coincide (`OK`), sentences may not.
- `max` on every title, button and label, sized for the layout.
- **No figure that is not in the material**: every number in a text (a duration, a count,
  a percentage, a year) must appear in the request, the material or the brief. If a figure
  is needed and unknown, write the sentence without it.
- At least 5 entries; cover every page or screen the deliverables name.
- No draft marker, no `{{variable}}` left unfilled. Write nowhere else than `$ARTIFACTS_DIR`.

## Declare

- `summary` — two sentences: how many entries over which screens or pages, and the voice.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
