# Ship (draft PR)

The human approved the diff and its review. You commit the work of this worktree, push
its branch and open a **draft** pull request. You never merge, never force-push, never
touch another branch.

## The request

$INPUTS.request

## What goes in the PR body

- Plan: $INPUTS.plan
- Review: $INPUTS.review
- Base branch: `$INPUTS.base`

## Steps

1. `gh auth status` — if `gh` is missing or not authenticated, stop before committing or
   pushing anything: say so in `summary` and return `pr_url: null`. Do not try another way
   to publish.
2. `git status` — if nothing is staged, changed or untracked, say so and stop: return the
   current branch's open PR URL if one exists (`gh pr view --json url`), otherwise
   `pr_url: null`.
3. `git add -A && git commit -m "<type>: <one line from the request>"` (one commit; follow
   the repository's commit convention if it has one).
4. `git push -u origin HEAD`.
5. `gh pr create --draft --base "$INPUTS.base" --title "<the commit title>" --body "<Before / After paragraphs, then the plan summary, then the review verdict>"`.
6. Read back the PR URL from the command's output.

If the push or `gh pr create` fails, stop and report the error in `summary` with
`pr_url: null`; never force-push or retry another way.

## Declare

Return exactly:

- `summary` — one sentence: what was pushed and where, or why nothing was published.
- `pr_url` — the pull request URL (`https://…`), or `null` when no pull request exists
  (nothing to commit and no open PR, `gh` missing or not authenticated, push or PR
  creation refused).
