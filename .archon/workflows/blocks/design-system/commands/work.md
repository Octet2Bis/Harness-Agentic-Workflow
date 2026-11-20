# Studio : the design system

You write the design system of a project in two files of `$ARTIFACTS_DIR`:
`$INPUTS.tokens_out` (the tokens, JSON) and `$INPUTS.out` (the document, Markdown). Pages,
screens and visuals will be built from these and nothing else. You run inside a loop: a
deterministic check measures both files after every turn; after three turns the block stops
with the checks still red and reports itself `unconverged`.

## The request

$INPUTS.request

## Material you can rely on

$INPUTS.context

## Upstream

Type: `$INPUTS.type` (empty: read `$ARTIFACTS_DIR/calibrage.json`). Read
`$ARTIFACTS_DIR/BRIEF.md` when it exists, and every existing file the calibration lists
(a theme file, a CSS, a design contract): **start from what exists**, keep what works, and
say in `Intention` what you changed and why.

## Problems the check reported on the previous turn

$INPUTS.problems

## `$INPUTS.tokens_out`

```json
{
  "color": {
    "light": { "bg": "#rrggbb", "surface": "…", "fg": "…", "muted": "…", "accent": "…", "border": "…" },
    "dark":  { "bg": "…", "surface": "…", "fg": "…", "muted": "…", "accent": "…", "border": "…" }
  },
  "font": { "display": "Family, fallback, generic", "body": "Family, fallback, generic" },
  "type_scale": [12, 14, 16, 20, 25, 31, 39],
  "space": [4, 8, 12, 16, 24, 32, 48],
  "radius": { "none": 0, "md": 8, "full": 999 },
  "components": [
    { "name": "Button", "tokens": ["color.accent", "radius.md", "font.body", "space"], "states": ["default", "hover", "pressed", "focus", "disabled"] }
  ]
}
```

What the check measures, so you can measure it first:

- Both themes define the same roles, at least the six above, as `#rrggbb`.
- WCAG contrast, in **each** theme: `fg` on `bg` and on `surface` ≥ 4.5:1, `muted` on `bg`
  ≥ 4.5:1, `accent` on `bg` ≥ 3:1.
- `type_scale`: at least 5 sizes, ascending, each step between ×1.05 and ×1.7, one body
  size between 14 and 18 px.
- `space`: at least 5 steps, ascending, on a 2, 4 or 8 px grid starting at that base.
- Components: at least 3 for a site or an app (1 for a graphic project); every token they
  name exists in the file; states include `default`, and `focus` whenever there is a
  `hover`, `pressed` or `active`.

## `$INPUTS.out`

French, at least 800 characters, sections `## Intention`, `## Couleurs`, `## Typographie`,
`## Espacements`, `## Composants` (every component of the token file, by name, described by
its token names, never a raw hex value), `## Règles d'usage` (rules a reviewer can check:
one accent action per screen, visible focus, colour never the only signal…).

Write nowhere else than `$ARTIFACTS_DIR`.

## Declare

- `summary` — two sentences: the direction in one line, and the main trade-off.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
