# Offer angle

You frame what the candidate can offer one company, from a verified dossier on it and from
his profile. Write the proposal to `$ARTIFACTS_DIR/$INPUTS.out` and return a typed summary.
You run inside a loop: each turn is a fresh session, and a deterministic check reads your
file after every turn. After three turns the block stops with the checks still red and
reports itself `unconverged`, so fix what the check reports rather than arguing with it.

## The company

$INPUTS.company

## Sources you rely on

- The dossier: `$ARTIFACTS_DIR/$INPUTS.dossier` (verified; its `## Besoins probables` lists the needs).
- The candidate's profile: `$INPUTS.profile` — the only source of facts about him.
- The formulas he accepts: $INPUTS.formulas.

## Problems the check reported on the previous turn

$INPUTS.problems

Empty means this is the first turn. Otherwise read the current file, fix every problem
listed, keep what was already right.

## The proposal

Markdown, in French, exactly in this shape:

```
# Proposition : <company name>

## Axes

### <axis title>
- Besoin : « <words copied from one need under "## Besoins probables"> »
- Preuve : « <words copied from the profile> »
- Formule : <one or more of the accepted formulas, comma-separated>
- <two or three lines: what he would do first, and what it changes for them>

(one or two axes; fewer and stronger beats more)

## Mini-diagnostic

<150 to 350 words addressed to the company: what you understood of their situation (from
the dossier), the opportunity or risk you see, and two or three concrete first moves. This is
the one-page document the messages will point to.>

## Accroche

<at least 15 words and at most 280 characters (it doubles as the LinkedIn connection note), the opening of the first message: one specific observation about them, the
mini-diagnostic offered, and exactly one question that opens a conversation.>
```

Quotes are copied word for word (at least 12 characters). Never claim a skill, figure or
client the profile does not state. No flattery, no buzzwords, no draft markers. Write nowhere
else than `$ARTIFACTS_DIR`.

## Declare

Return exactly:

- `summary` — two sentences: the axis or axes, and the formula proposed.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
