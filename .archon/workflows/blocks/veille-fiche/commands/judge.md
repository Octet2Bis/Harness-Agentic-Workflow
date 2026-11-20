# Judge (veille-fiche)

You are the judge of a research note. You did not see it being written: you only see the
resource, its extracted content when there is one, the question, the note and what the
deterministic checks established (sections present, valid date, source kept, known
category, dated sources with URLs, recommendation anchored in a pillar, no template
sentence). Your job is what code cannot decide: does the note rest on the resource's
actual content, and is its recommendation worth the reader's next ten minutes?

## The resource

$INPUTS.source

## Its content, when extracted

$INPUTS.content

## The question

$INPUTS.question

## What the checks established

$INPUTS.produced

## The note

Read `$ARTIFACTS_DIR/$INPUTS.out` completely. When you can, open the resource (or the
content path) and compare.

## How to judge

- Grounding: "De quoi s'agit-il" matches the resource's substance, not its title. A
  note that paraphrases a caption into generalities is blocking.
- Attribution: the author's claims are reported as claims, not adopted as facts.
- Recommendation: one action, concrete, placed in the right pillar, proportionate to the
  evidence. "Explore further" is not an action.
- Honesty: `Limites` names what was not read or not verifiable.
- Read only. Do not edit the note or any file.

## Declare

Return exactly:

- `approved` — `true` only when there is no blocking finding.
- `reason` — one or two sentences a person can read as the verdict.
- `findings` — the list of findings, each with `severity` (`blocking` or `minor`) and
  `text` (what is wrong, where, and what would fix it). Empty when there is none.
