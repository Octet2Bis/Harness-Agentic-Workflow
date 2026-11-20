# Studio : calibrate the project

You decide what kind of project this is before anyone designs anything, and write the
decision to `$ARTIFACTS_DIR/$INPUTS.out`. You run inside a loop: each turn is a fresh
session, and a deterministic check reads your file after every turn. After three turns the
block stops with the checks still red and reports itself `unconverged`, so fix what the
check reports rather than arguing with it.

## The request

$INPUTS.request

## Material you can rely on

$INPUTS.context

Paths in it are absolute: read them. The existing project folder, if any, is
`$INPUTS.project_dir`.

## Problems the check reported on the previous turn

$INPUTS.problems

Empty means this is the first turn.

## The three kinds

| `type` | It is | Its lane after the common steps |
|---|---|---|
| `graphique` | Purely visual: identity, art direction, campaign, print, social, packaging. No product to build. | direction-artistique → declinaisons → kit-de-marque |
| `site` | Pages people read on the web: showcase site, portfolio, landing pages, shop front. | arborescence → pages → seo-tracking |
| `app` | A product people use repeatedly: mobile, web or desktop app with screens and states. | prd → ecrans → fonctionnalites |

A landing page for an app is a `site`. A logo for a site is still part of the site's
design system, not a `graphique` project, unless the request is only the identity. When the
request mixes kinds, pick the one whose deliverable the requester will judge the project on,
and say why in `summary`.

## The file

Write `$ARTIFACTS_DIR/$INPUTS.out`, JSON only:

```json
{
  "type": "graphique | site | app",
  "evidence": ["passages of the request, copied word for word, that decide the type"],
  "deliverables": ["what must exist at the end, in the requester's words"],
  "platforms": ["graphique: print, social, web, video, packaging, signaletique | site: web | app: ios, android, web, desktop"],
  "existing": ["paths, relative to the project folder, of work already done that the next steps must start from"],
  "route": ["the exact step list for this type, see below"]
}
```

`route` is fixed by the type, you copy it, you do not invent it:

- `graphique`: `["brief", "design-system", "content-base", "direction-artistique", "declinaisons", "kit-de-marque", "qa-finale", "go", "diffusion"]`
- `site`: `["brief", "design-system", "content-base", "arborescence", "pages", "seo-tracking", "qa-finale", "go", "diffusion"]`
- `app`: `["brief", "design-system", "content-base", "prd", "ecrans", "fonctionnalites", "qa-finale", "go", "diffusion"]`

`existing` lists only files you opened. Leave it empty rather than guess. Write nothing
anywhere else than `$ARTIFACTS_DIR`.

## Declare

Return exactly:

- `summary` — two sentences: the type and the passage that decides it, then what already exists.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
