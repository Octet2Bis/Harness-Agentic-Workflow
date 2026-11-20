# Harness Agentic Workflow

[![Gates](https://github.com/Octet2Bis/Harness-Agentic-Workflow/actions/workflows/gates.yml/badge.svg)](https://github.com/Octet2Bis/Harness-Agentic-Workflow/actions/workflows/gates.yml)

**Agentic workflows that have to prove their output before a human sees it.**
Built on [Archon](https://github.com/coleam00/Archon). Every task is a *block*: an agent works, code checks the result in a loop, a judge with a fresh context decides, and only then does a person look. Nothing leaves the repo (an application, an email, a publication) without that person's go.

```
trigger → board → listener → system ─┬─ block: agent ⇄ code checks (loop, max 3 tries) → fresh-context judge → VERIFIED
                                     ├─ blocks in parallel (variants, offers)
                                     └─ human approval, at the very end
```

## Why it is built this way

- **Code checks what code can check.** Length, sections, sources cited, keywords covered, no invented figure, contrast ratios, JSON shapes: deterministic, free, repeatable. The model only judges what code cannot (is it convincing, is it right for this reader).
- **One model per task, picked for its cost.** Each node declares a tier (`small`, `medium`, `large`). Writers run on `medium` and judges on `large` by default; on the job-application chain, judges drop to `medium` and only the CV designer writes on `large`. Code checks spend zero tokens, and a block stops after 3 tries instead of looping on a bill.
- **The judge cannot cheat.** Fresh context, read-only tools, no write access to the checkout: enforced by the engine, and verified by the gates.
- **Every outcome is tested without calling a model.** Each block ships fixtures for *verified*, *rejected*, *unconverged* and its output contract; the gates replay them all offline.

## Use cases

| Area | System or block | What it does | Status |
|---|---|---|---|
| Career | `career-radar` | Job radar without any model: sources → dedupe → language / remote / seniority jury → board | VERIFIED |
| Career | `career-triage` · `job-triage` | Reads the posting, extracts languages, salary, work mode and experience **with verbatim quotes**; code decides, a judge checks the quotes | VERIFIED |
| Career | `career-apply` | Validated offer → posting guard → tailored CV → one-page letter → verified PDF → right platform → form filled → human go → receipt | VERIFIED |
| Career | `cv-tailor` · `cover-letter` · `interview-prep` · `decision-makers` | Tailored CV (no figure that is not in the profile), letter, interview prep with STAR stories, who to write to (public sources only, no email address ever) | VERIFIED |
| GTM | `company-outreach` | Full-remote company → two-page dossier (≥ 4 sources) → offer angle → 4-touch sequence → human go; no cold email where GDPR practice forbids it (DE, AT) | VERIFIED |
| GTM | `outbound-sequence` · `aeo-asset` · `landing-page` | Email sequence (≤ 120 words, distinct angles, no spam words), citable page + JSON-LD, standalone landing page with DataLayer and one CTA | VERIFIED |
| Research | `research` → `design` → `report` · `veille-fiche` | Sourced research, design options, report; watch card (problem, impact, recommendation) from a link | VERIFIED |
| Dev | `feature-build` · `implement` · `review` · `design-variants` | Request → plan → implement until tests are green → lint → reviewed diff → human go → draft PR; 3 landing variants in parallel | VERIFIED |
| Studio | `studio`: `studio-calibrate` → `studio-brief` → `design-system` → `content-base` | One front door for design and dev projects: the request is calibrated as graphic, site or app (verbatim quotes), then brief, tokens with WCAG AA contrast computed in both themes, type scale and spacing grid, and a content base with every locale and no invented figure; ends on the route of the next lane | VERIFIED |

Statuses live in one place: [`.archon/workflows/blocks/REGISTRY.md`](.archon/workflows/blocks/REGISTRY.md). `VERIFIED` means every gate passes offline; `PROUVÉ` (proven) is reserved for a block that has also passed real runs.

## Tests & quality

`scripts/gates.sh` runs every gate, in order, without spending a token:

1. **The gates can fail.** A meta-test feeds each rule a known violation and expects it to be caught.
2. **Static rules** (`RULES.md` R1–R6): a loop must hand back control, every block has a judge and its fixtures, statuses only in the registry…
3. **Machine contract**: `harness.json` is regenerated and must match.
4. **Unit tests** of every check (`*.test.ts`), the cockpit included.
5. **Every workflow**: `archon validate`, then each fixture replayed and its outcome asserted against the real script output.

The first real run taught the gates something: it reached the model and exposed two contract bugs invisible offline. Both were fixed the same day and are now caught by a gate (rule R4).

## Run it

Requirements: [bun](https://bun.sh) ≥ 1.2.21 and the Archon CLI (or a checkout of the Archon repo after `bun install`).

```bash
ARCHON_SRC=/path/to/Archon scripts/gates.sh          # all gates, zero model call
archon workflow run research --input task="Compare A and B"
archon workflow run outbound-sequence --input brief="…" --input icp="…"
archon workflow approve <run-id>                      # the human go
```

## Map

```
AGENTS.md RULES.md MECHANICS.md POSTURE.md   order of authority (rules → mechanics → posture)
.archon/workflows/blocks/    one block = one job: agent, code checks, judge, fixtures
.archon/workflows/systems/   what chains the blocks (career, outreach, pipeline, board listener)
integrations/cockpit/        local cockpit: offers, triage, runs, go, from the phone over a private network
integrations/vm-radar/       the always-on radar on a small VM, no model in the loop
use-cases/README.md          every use case → block or system, with its status
scripts/gates.sh             the gates
docs/                        how the reel maps onto Archon, the block template
```

Documentation inside the repo is in French; [`README.fr.md`](README.fr.md) is the full French guide. *Master Plan* is the name of the earlier private monorepo these use cases come from.

## Also built this way

- [Aevum](https://github.com/Octet2Bis/Aevum): iOS wellness app prototype and its web simulator, data parity checked in CI.
- [Homemade MailMerger](https://github.com/Octet2Bis/Homemade-MailMerger): local outreach studio; the audit that found 7 critical defects behind green tests, and the regression tests that now guard them.

By Antoine Lecerf, built with Claude Code. Personal data in test fixtures is fictional.
