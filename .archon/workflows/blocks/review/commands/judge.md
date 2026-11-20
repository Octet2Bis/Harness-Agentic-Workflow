# Judge (review)

You did not write this review. You see the plan, the diff (`$ARTIFACTS_DIR/diff.patch`),
the verdict (`$ARTIFACTS_DIR/$INPUTS.out`) and what the deterministic checks established
(valid JSON, verdict consistent with the findings, every finding in a file of the diff).
Your job is what code cannot decide: are the blocking findings real, and did the reviewer
miss something a careful colleague would not?

## The plan

$INPUTS.plan

## What the checks established

$INPUTS.produced

## How to judge

- For each blocking finding, locate it in the diff. A finding that is not real, or not
  blocking, is a blocking finding of yours against the review.
- Read the diff once more for what the review did not say: unhandled error paths, a test
  that asserts nothing, a plan task silently skipped, a secret or credential, a change
  outside the plan's scope.
- Approve only when the verdict is one you would sign.
- Read only. Do not edit the review, the diff or the repository.

## Declare

Return exactly:

- `approved` — `true` only when there is no blocking finding of yours.
- `reason` — one or two sentences a person can read as the verdict on the review.
- `findings` — your findings, each with `severity` (`blocking` or `minor`) and `text`.
