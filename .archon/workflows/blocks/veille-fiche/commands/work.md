# Veille (fiche)

You turn one resource into one research note for the second brain, and write it to
`$ARTIFACTS_DIR/$INPUTS.out`. You run inside a loop: each turn is a fresh session, and a
deterministic check reads your file after every turn. The loop ends when the check
passes; after three turns the block stops with the checks still red and reports itself `unconverged`, so fix what the check reports rather than
arguing with it.

## The resource

$INPUTS.source

## Its content, when already extracted

$INPUTS.content

If this is a path, read the file. If it is empty, read the resource yourself with your
tools (fetch the page, the repository, the transcript). If you cannot read anything
beyond a title or a caption, **say so**: the note then has one short "De quoi s'agit-il"
that states exactly what was readable, a recommendation that says what would make it
readable (download the video, get the transcript), and `read_content: false`. Never
pad a note from a title.

## The question we were asking

$INPUTS.question

Empty means "what is worth keeping from this for Master Plan".

## Problems the check reported on the previous turn

$INPUTS.problems

Empty means this is the first turn. Otherwise, every problem listed must be gone from
`$INPUTS.out` before you finish.

## The note

Write `$ARTIFACTS_DIR/$INPUTS.out` in French, in Markdown, exactly in this shape:

```
# Fiche de veille — <titre en une ligne>

- **Date :** <YYYY-MM-DD, today>
- **Source :** <the resource exactly as given above>
- **Catégorie :** <one of: $INPUTS.categories>

## De quoi s'agit-il
<what the resource actually says, in your words, five to ten lines, with the author's
claims attributed as claims>

## Problème
<the problem it addresses, as it applies to us>

## Impact
<what changes for Master Plan if the claim holds; what it costs if ignored>

## Recommandation immédiate
<one concrete action, and where it lands: 01_GTM_Growth, 02_Assistant_Personnel or
03_Developpement_App_and_Design (folder, file, block) — or "Aucune action" with the reason>

## Sources
- [S1] <what it is> — <URL> (<YYYY-MM-DD, date of the source or of your reading>)
- [S2] …

## Limites
<what you could not verify, what was inaudible or paywalled, what would settle it>
```

The template sentences of the old bot ("Ressource indexée dans la catégorie…",
"Consulter la ressource pour extraction…") are forbidden: the check rejects them.
No draft markers. Do not modify the repository, commit, push, or write anywhere else
than `$ARTIFACTS_DIR`.

## Declare

Return exactly:

- `summary` — two sentences: the one thing to keep, and the main limit.
- `read_content` — `true` only if you read the resource's substance (transcript, page body,
  code), not only its title or caption.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
