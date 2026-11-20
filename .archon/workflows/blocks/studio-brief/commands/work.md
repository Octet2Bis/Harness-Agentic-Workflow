# Studio : the brief (gate 0)

You write the brief of a calibrated project to `$ARTIFACTS_DIR/$INPUTS.out`. A designer or
developer reads it in two minutes and knows what to build, for whom, and what not to build.
You run inside a loop: a deterministic check reads your file after every turn; after three
turns the block stops with the checks still red and reports itself `unconverged`.

## The request

$INPUTS.request

## Material you can rely on

$INPUTS.context

## The calibration

Type: `$INPUTS.type`. When empty, read `$ARTIFACTS_DIR/calibrage.json` (type, deliverables,
platforms, existing files) and start from it. Read the existing files it lists.

## Problems the check reported on the previous turn

$INPUTS.problems

## The brief

French, Markdown, 600 to 6 000 characters, exactly these sections:

```
# Brief : <projet>

## Problème
<the problem in the requester's terms, for the people who have it>

## Cible
<who, in what situation, with what constraint>

## Contexte d'usage
<when and where the thing is used or seen>

## Hors-champ
- <a thing this project will NOT do>   (at least 3)

## Appétit
<time and people the requester is ready to spend; what comes first>

## Plateforme
<where it lives: name the platform(s) of the calibration>

## Critères de réussite
- <something a person can check at the end>   (at least 2)
```

Only what the request, the material or the existing files say. When something is unknown
(budget, deadline), write that it is unknown and who decides; do not invent it. No draft
markers. Write nowhere else than `$ARTIFACTS_DIR`.

## Declare

- `summary` — two sentences: the problem, and the hardest cut in Hors-champ.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
