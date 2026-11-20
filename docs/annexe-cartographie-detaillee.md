# Annexe — cartographie détaillée reel ↔ Archon

Généré depuis une passe de lecture d'Archon (dix lecteurs indépendants, un concept chacun, 2026-10-16). Chaque entrée nomme la brique Archon, les clés YAML ou commandes CLI, un extrait, ce qui manque, et les citations `fichier:lignes` dans le dépôt Archon (`packages/docs-web/src/content/docs/…` = la documentation du livre et des guides). Les citations ont été contrôlées mécaniquement (fichier présent, lignes dans la plage) ; elles n'ont pas été relues une à une par un second lecteur. Le résumé lisible est dans `01-cartographie.md`.


## A — Le code vérifie et renvoie les erreurs en boucle

Archon implements the video's first loop natively: a `loop:` node whose only exit is `until_bash` (a shell check that must exit 0, bounded by `max_iterations`, failing the node when the bound is hit), and a `loop_group:` whose body is implement -> deterministic `bash:`/`script:` check, with `until_bash` reading the check's output and the next iteration receiving the failure details through `$LOOP_PREV.<check>.output` / `$LOOP_PREV_OUTPUT`. Checks are ordinary bash/script nodes (optionally certified with `output_format`), their stdout/stderr tails are retained as `exec_output` evidence, and the docs explicitly recommend "code runs the tests, the AI fixes them" (dag-workflows.md:341). What is only approximated: in-session checks that fire on each file write (YAML `hooks:` are static reminders, real logic needs native Claude hooks; neither applies to `loop:` iterations), a "VERIFIED" status for a block (`outcome_field` and `evidence_policy` exist but there is no verification node or status), and feeding an `until_bash` probe's own output back to the agent (only retained as evidence, not as a variable). The bundled sdlc pack YAMLs and the DAG/loop executor source (`until_bash` handling) are absent from this copy; only docs and test-fixture name references exist.


### A-code-checks.1 Loop node with deterministic exit (`loop:` + `until_bash` + `max_iterations`)  —  couverture : **natif**

- YAML / CLI : `nodes[].loop.until_bash, nodes[].loop.max_iterations (required), nodes[].loop.prompt | nodes[].loop.command, nodes[].loop.fresh_context, node-level timeout (bounds each until_bash check, default 120000 ms)`

```yaml
- id: fix-tests
  timeout: 900000              # budget for each until_bash check
  loop:
    prompt: Run the test suite. Read the failures. Fix them one at a time.
    max_iterations: 8
    until_bash: "bun run test"   # exit 0 = done; no `until:` so prose cannot end it
    fresh_context: false
```
- Ce qui manque ou diffère : The until_bash probe's stdout/stderr is retained only as evidence (exec_output), not exposed as a variable to the next iteration, so the agent must re-run the checks inside its own session to see failure details (or use loop_group). Combining `until:` with `until_bash` lets a prose sentinel end the loop without the check agreeing (channels are OR'd, loop-nodes.md:452-466): drop `until:`. `hooks`, `mcp`, `skills` are discarded on loop nodes (loop-nodes.md:489-498).
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:62`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:67-68`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:73`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:80`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:86-100`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:201-204`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:229-259`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:271`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:433-466`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:513-521`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:216`, `packages/docs-web/src/content/docs/book/quick-reference.md:210-214`


### A-code-checks.2 Cross-node loop (`loop_group:`) with a deterministic check node and `$LOOP_PREV` feedback  —  couverture : **natif**

- YAML / CLI : `nodes[].loop_group.nodes (sealed body), loop_group.until_bash reading `$<check>.output[.field]`, loop_group.max_iterations, loop_group.fresh_context; `$LOOP_PREV.<nodeId>.output[.field]` in body prompts/with:, `when: "$LOOP_PREV.<nodeId>.output == 'red'"` on body nodes`

```yaml
- id: fix-loop
  loop_group:
    until_bash: test $test.output = "green"
    max_iterations: 5
    nodes:
      - id: implement
        prompt: |
          Previous attempt's test output:
          $LOOP_PREV.test.output
          Fix what failed.
      - id: test
        bash: |
          if bun test; then printf 'green'; else printf 'red'; fi
        depends_on: [implement]
```
- Ce qui manque ou diffère : A body node that exits non-zero fails the whole group immediately (loop-nodes.md:598), so the check must always exit 0 and encode its verdict in stdout (or a JSON output_format). `retry:` is rejected on the group (configure it on body nodes); `until_field` is not supported on groups; failure resume restarts at iteration 1 with no per-body-node resume; only the immediately prior iteration is reachable (no `$LOOP_PREV...[N]` history); nested groups not hardened (v1). `include:` works in the body but `workflow:` sub-runs do not.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:543-575`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:586-603`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:598`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:689-706`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:712-768`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:770-782`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:784-830`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:831-865`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:217`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:558-563`, `packages/docs-web/src/content/docs/reference/variables.md:141-165`, `packages/docs-web/src/content/docs/book/quick-reference.md:231-261`


### A-code-checks.3 Previous-iteration feedback for fresh-context loops (`$LOOP_PREV_OUTPUT`)  —  couverture : **partiel**

- YAML / CLI : ``$LOOP_PREV_OUTPUT` inside loop.prompt / loop.command text; loop.fresh_context: true`

```yaml
- id: implement-and-qa
  loop:
    prompt: |
      Implement the plan, then run `bun run validate`.
      If checks fail, fix the failures.
      Previous iteration output (empty on first pass):
      $LOOP_PREV_OUTPUT
    fresh_context: true
    max_iterations: 3
    until_bash: "bun run validate"
```
- Ce qui manque ou diffère : Carries the agent's own cleaned previous output, not the result of the deterministic check; the check's verdict reaches the agent only if the agent itself printed it, or via a loop_group body node and `$LOOP_PREV.<node>.output`. Delivered to bash:/script: only as the LOOP_PREV_OUTPUT env var.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:123-130`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:212-227`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:385-410`, `packages/docs-web/src/content/docs/reference/variables.md:150`


### A-code-checks.4 Deterministic check nodes (`bash:` / `script:`) gating downstream work (`when:`, `trigger_rule`, `cancel:`)  —  couverture : **partiel**

- YAML / CLI : `nodes[].bash, nodes[].script + runtime: bun|uv, timeout, on_timeout: skip, when: "$check.output == 'failed'", trigger_rule: all_done|none_failed_min_one_success, cancel: "<reason>"`

```yaml
- id: implement
  command: implement-feature
- id: check
  bash: "bun run validate >/dev/null 2>&1 && echo ok || echo failed"
  depends_on: [implement]
- id: fix
  prompt: "Validation failed; fix it. Report: $check.output"
  depends_on: [check]
  when: "$check.output == 'failed'"
- id: stop-if-blocked
  cancel: "Checks still red after fix"
  depends_on: [fix]
  when: "$check.output == 'failed'"
```
- Ce qui manque ou diffère : One pass only: the DAG is acyclic, so a failed check cannot send work back to the agent more than once without wrapping the pair in a loop_group. A non-zero exit fails the node (and, by default, dependants), and a failed producer's output can never be read downstream (authoring-workflows.md:580, 682), so a check used as a gate must exit 0 and print its verdict. Whole-output comparison in when: is allowed only for bash:/script: producers (616).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:214-215`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:220`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:230-231`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:261-284`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:455-456`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:580`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:616`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:682`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1997-1998`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2008`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3601-3619`, `packages/docs-web/src/content/docs/guides/script-nodes.md:13-20`, `packages/docs-web/src/content/docs/guides/script-nodes.md:76-83`, `packages/docs-web/src/content/docs/guides/hooks.md:65`, `packages/docs-web/src/content/docs/book/dag-workflows.md:252`, `packages/docs-web/src/content/docs/book/dag-workflows.md:263-272`, `packages/docs-web/src/content/docs/book/dag-workflows.md:341`, `packages/docs-web/src/content/docs/getting-started/concepts.md:42`


### A-code-checks.5 Result contract on a check node (`output_format` on `bash:`/`script:`), read by `until_bash` / `when:`  —  couverture : **natif**

- YAML / CLI : `nodes[].output_format (JSON Schema) on bash:/script:; `$check.output.<field>` in when: and until_bash; loop_group.until_bash: '[ $decide.output.done = "true" ]'`

```yaml
- id: check
  script: |
    const r = Bun.spawnSync(["bun", "run", "validate"]);
    console.log(JSON.stringify({
      green: r.exitCode === 0,
      log: r.stdout.toString().slice(-2000) + r.stderr.toString().slice(-2000),
    }));
  runtime: bun
  output_format:
    type: object
    properties: { green: { type: boolean }, log: { type: string } }
    required: [green, log]
# in the enclosing loop_group:
#   until_bash: 'g=$check.output.green; [ "$g" = true ]'
```
- Ce qui manque ou diffère : Stdout must be exactly one strict JSON document; a contract miss fails the node and is never retried (no reask for scripts). Field paths cannot index arrays; when: needs a scalar.
- Citations : `packages/docs-web/src/content/docs/guides/script-nodes.md:103`, `packages/docs-web/src/content/docs/guides/script-nodes.md:276-310`, `packages/docs-web/src/content/docs/guides/script-nodes.md:470-472`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2921`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1002`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:340-352`, `packages/docs-web/src/content/docs/reference/variables.md:97-119`


### A-code-checks.6 Schema-validated model verdict as loop exit (`until_field` + `output_format` on `loop:`)  —  couverture : **partiel**

- YAML / CLI : `nodes[].loop.until_field: <boolean property>, nodes[].output_format with that property required and type boolean`

```yaml
- id: triage
  output_format:
    type: object
    properties:
      done: { type: boolean }
    required: [done]
  loop:
    prompt: Work the next backlog item. Report whether the backlog is empty.
    max_iterations: 20
    until_field: done
```
- Ce qui manque ou diffère : This is the model's own judgment, not a deterministic code check; the docs reserve it for cases with 'nothing on disk to test' (loop-nodes.md:303-305). Not supported on loop_group. Use it only in combination with until_bash, or prefer until_bash when the condition is externally checkable (loop-nodes.md:80).
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:63-65`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:81`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:287-352`


### A-code-checks.7 Static in-session quality pressure (YAML `hooks:` PostToolUse `additionalContext` / `systemMessage`)  —  couverture : **partiel**

- YAML / CLI : `nodes[].hooks.PostToolUse[].matcher, .response.hookSpecificOutput.{hookEventName: PostToolUse, additionalContext}, .response.systemMessage; PostToolUseFailure.additionalContext`

```yaml
- id: implement
  command: implement-changes
  hooks:
    PostToolUse:
      - matcher: "Write|Edit"
        response:
          hookSpecificOutput:
            hookEventName: PostToolUse
            additionalContext: |
              You just modified a file. Re-read it, run `bun run type-check`,
              and fix any errors before proceeding.
```
- Ce qui manque ou diffère : Responses are deliberately static: no code runs and nothing is verified; the docs say it 'doesn't guarantee the model complies' (hooks-and-quality.md:142). Claude only; `hooks:` is dropped on loop:/loop_group iterations; YAML hooks record no hook events.
- Citations : `packages/docs-web/src/content/docs/guides/hooks.md:16`, `packages/docs-web/src/content/docs/guides/hooks.md:59-77`, `packages/docs-web/src/content/docs/guides/hooks.md:204-217`, `packages/docs-web/src/content/docs/guides/hooks.md:295-300`, `packages/docs-web/src/content/docs/guides/hooks.md:423-426`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:114-144`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:185`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:489-498`


### A-code-checks.8 Native Claude Code hooks loaded through `settingSources` (real check logic on each tool call)  —  couverture : **partiel**

- YAML / CLI : `nodes[].settingSources: ['project'] | ['project','user'] | []; `.claude/settings.json` hooks.PreToolUse/PostToolUse[].hooks[].{type: command, command}; hook events in `archon workflow logs` / GET /api/workflows/runs/{runId}/provider-events`

```yaml
# .claude/settings.json (checked-out branch) — runs code after each Write
# { "hooks": { "PostToolUse": [ { "matcher": "Write|Edit",
#     "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/lint-file.sh" } ] } ] } }
name: guarded-fix
description: Fix a bug with the project's hooks active
provider: claude
nodes:
  - id: fix
    prompt: "Fix the bug described in $ARGUMENTS"
    settingSources: ['project']
  - id: test
    bash: "bun run test"
    depends_on: [fix]
```
- Ce qui manque ou diffère : Lives in Claude configuration, not in the workflow YAML (hooks.md:64-77); Claude only; the hook's blocking/feedback semantics are Claude Code's, not Archon's; the docs do not state that loop:/loop_group iterations load settings-file hooks (the loop executor manages its own sessions, loop-nodes.md:497).
- Citations : `packages/docs-web/src/content/docs/guides/hooks.md:64`, `packages/docs-web/src/content/docs/guides/hooks.md:79-96`, `packages/docs-web/src/content/docs/guides/hooks.md:97-140`, `packages/docs-web/src/content/docs/guides/hooks.md:401-419`


### A-code-checks.9 Retry policy (`retry:`) for check nodes and loop iterations  —  couverture : **partiel**

- YAML / CLI : `nodes[].retry.max_attempts (1-5, required), nodes[].retry.delay_ms, nodes[].retry.on_error: transient|all (bash/script non-zero exit retried only under `all`; loops accept only transient)`

```yaml
- id: flaky-check
  bash: "./scripts/integration-smoke.sh"
  retry:
    max_attempts: 2
    delay_ms: 5000
    on_error: all      # bash/script never auto-retry; non-zero exit is UNKNOWN
```
- Ce qui manque ou diffère : Re-runs the same check or iteration; it does not hand the failure back to the agent. A script whose stdout fails its output_format is never retried; loop_group rejects retry:.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:910-950`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:952-960`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:992-1004`, `packages/docs-web/src/content/docs/guides/script-nodes.md:108-112`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:517-540`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:858`


### A-code-checks.10 Engine-enforced checkout invariant (`mutates_checkout: false`)  —  couverture : **partiel**

- YAML / CLI : `nodes[].mutates_checkout: false (git status compared before/after; node fails naming changed paths)`

```yaml
- id: review
  prompt: "Review the diff and report findings only"
  mutates_checkout: false   # engine fails the node if the checkout changed
```
- Ce qui manque ou diffère : A built-in deterministic check for one invariant (no checkout writes); it fails the node rather than sending feedback to the agent, and is skipped outside a git repository.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:235`


### A-code-checks.11 Retained subprocess evidence for every check (`exec_output` rows, `archon workflow logs`)  —  couverture : **natif**

- YAML / CLI : `archon workflow logs <run-id> [--follow] [--format text]; archon workflow get <run-id> --json (terminal_record); transcript ~/.archon/workspaces/<project>/logs/<run-id>.jsonl`

```yaml
archon workflow logs <run-id> --follow --format text
# each bash:/script: node and each until_bash probe (step `<node>-iteration-<n>`)
# yields an exec_output row with exit_code, stdout_tail, stderr_tail (2000 chars each)
```
- Ce qui manque ou diffère : Evidence only: tails are capped at 2000 chars and credential-redacted, and are not available as `$nodeId.output` to later nodes.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1494-1530`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1507`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1512`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2827-2844`, `packages/docs-web/src/content/docs/guides/script-nodes.md:86-89`, `packages/docs-web/src/content/docs/reference/cli.md:763`


### A-code-checks.12 Authored verdict and evidence marker for a block (`returns:` + `outcome_field`, `evidence_policy`)  —  couverture : **partiel**

- YAML / CLI : `workflow-level returns: <node-id>, outcome_field: <boolean property of that node's output_format>, evidence_policy: { required: true } ($ARTIFACTS_DIR/evidence.json must exist)`

```yaml
name: review-block
description: Reviews a diff and records whether it is green
returns: verdict
outcome_field: green
nodes:
  - id: check
    bash: "bun run validate >/dev/null 2>&1 && echo green || echo red"
  - id: verdict
    depends_on: [check]
    bash: 'v=$check.output; printf ''{"green":%s}'' "$([ "$v" = green ] && echo true || echo false)"'
    output_format:
      type: object
      properties: { green: { type: boolean } }
      required: [green]
```
- Ce qui manque ou diffère : 'There is no special verification node or verification status' (authoring-workflows.md:2008): outcome_field is an authored boolean independent of lifecycle status, and evidence_policy only checks that a file exists, not that a check ran. Nothing marks a workflow/block as VERIFIED.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1991`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1964`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1969`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2846-2898`


### A-code-checks.13 Testing the checks and the loop wiring without an agent (`archon validate workflows`, `workflow run --dry-run --stubs --exec-code`)  —  couverture : **partiel**

- YAML / CLI : `archon validate workflows [name] [--json]; archon workflow run <name> --dry-run --stubs <file.yaml> [--exec-code] [--default-stubs] [--stubs-init <path>] [--json]`

```yaml
archon validate workflows fix-until-green
archon workflow run fix-until-green --dry-run --stubs-init fixtures/fix.yaml
archon workflow run fix-until-green --dry-run --stubs fixtures/fix.yaml --exec-code --json \
  | jq '.trace, .outcome, .authoredOutcome'
```
- Ce qui manque ou diffère : Dry-run exercises routing, joins and bash/script bodies (with --exec-code) but never runs an agent; a tolerated loop completes on its first iteration, so the repeat-until-green behaviour itself is not simulated. `workflow test` fixtures are mentioned (cli.md:441) but have no documented command section in this copy.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:351-356`, `packages/docs-web/src/content/docs/reference/cli.md:408-447`, `packages/docs-web/src/content/docs/reference/cli.md:1492-1505`, `packages/docs-web/src/content/docs/guides/script-nodes.md:370-380`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:495-498`, `packages/docs-web/src/content/docs/reference/variables.md:163`


### A-code-checks.14 Bundled sdlc pack: `archon-validate` (deterministic check runner) and `archon-deliver` (capped implement -> review -> CI rounds)  —  couverture : **partiel**

- YAML / CLI : `archon workflow run archon-validate --no-worktree [--input scope=<package or check>]; archon workflow run archon-deliver --branch <branch> "<plan>" [--input pull_request=<n>]`

```yaml
archon workflow run archon-validate --no-worktree --input scope=core
# discovers and runs types/lint/tests/build, reports a structured verdict, fixes nothing
archon workflow run archon-deliver --branch feat/export-csv "Deliver the plan in .archon/plans/csv-export.md"
# review findings / CI red go back to the implementer, up to three rounds
```
- Ce qui manque ou diffère : The pack YAMLs are not in this copy, so how archon-deliver wires its rounds (loop_group vs sub-runs) cannot be verified here; archon-validate is one-shot and judges/fixes nothing; the deliver loop's checks are PR review plus CI, not a local until_bash.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:13`, `packages/docs-web/src/content/docs/book/essential-workflows.md:36-38`, `packages/docs-web/src/content/docs/book/essential-workflows.md:176-189`, `packages/docs-web/src/content/docs/book/essential-workflows.md:215-224`, `packages/docs-web/src/content/docs/book/essential-workflows.md:267`, `packages/docs-web/src/content/docs/guides/global-workflows.md:58`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3739`


## B — Le juge en contexte vierge

Archon has no dedicated "judge" or verification node type (the docs say so explicitly at guides/authoring-workflows.md:2008), but the concept is fully expressible as a convention of existing primitives: a `prompt:`/`command:` node with `context: fresh` (new session), a lean read-only envelope (`allowed_tools`, `settingSources: []`, `skills: []`, hooks deny, `mutates_checkout: false`), a per-node `provider:`/`model:`, an `output_format` schema with an enum/boolean verdict, and `when:` / `until_bash` / `cancel:` gating on that verdict. The documented "Named owner sessions" loop_group (worker keeps its session, reviewer starts fresh, `until_bash` reads `$review.output.done`) and the `returns:` + `outcome_field:` block signature are the closest first-class matches; what is missing is engine-level independence/blindness, multi-judge aggregation, and any built-in judge quality evaluation. The bundled sdlc pack (archon-review etc.) is absent from this copy.


### B-fresh-judge.1 Fresh-session AI node (`context: fresh`)  —  couverture : **natif**

- YAML / CLI : `nodes[].context: fresh  (on a `prompt:` or `command:` node); also `context: { resume: <node-id> }` to fork a named upstream session instead`

```yaml
nodes:
  - id: implement
    command: implement-changes
  - id: judge
    prompt: |
      Review ONLY the diff below against the intent in $ARGUMENTS.
      Diff: $diff.output
    context: fresh          # new session: no memory of the implementer's turn
    depends_on: [implement, diff]
```
- Ce qui manque ou diffère : Freshness is about the provider session only: the judge still runs in the same checkout and `$ARTIFACTS_DIR`, so hiding the worker's reasoning/transcript from it is a convention (pass only the diff/artifact via `$node.output` or `with:`), not an engine guarantee. A composed block's entry node is fresh by default (1756-1759).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:198`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:232`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:286-313`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1232-1236`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3383-3418`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3721`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1756-1759`


### B-fresh-judge.2 Structured verdict with `output_format` gating downstream nodes via `when:`  —  couverture : **natif**

- YAML / CLI : `nodes[].output_format (JSON Schema, `enum`/`boolean` decision field, `required`, `additionalProperties: false`) + nodes[].when: "$judge.output.<field> == '<value>'" + optional `cancel:``

```yaml
  - id: judge
    prompt: "Judge the change. Return verdict and reasons."
    context: fresh
    depends_on: [implement]
    output_format:
      type: object
      properties:
        verdict: { type: string, enum: [pass, fail] }
        reasons: { type: string }
      required: [verdict, reasons]
      additionalProperties: false
  - id: ship
    command: create-pr
    depends_on: [judge]
    when: "$judge.output.verdict == 'pass'"
```
- Ce qui manque ou diffère : Enforced (grammar-constrained) only on Claude/Codex/OpenCode; Pi/Copilot are best-effort with up to 3 re-asks then node failure. `when:` compares scalars only (no arrays/objects, no parentheses). A `fail` verdict does not by itself fail or stop the run: pair it with a `cancel:` node (`when: "$judge.output.verdict == 'fail'"`) or a `bash: exit 1` node to make it hard-gate.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:710-748`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:518-576`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:589-631`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3601-3621`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:34-44`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:77`, `packages/docs-web/src/content/docs/reference/variables.md:97-115`


### B-fresh-judge.3 Lean, read-only judge envelope (`allowed_tools` / `denied_tools`, `settingSources: []`, `skills: []`, YAML `hooks` deny, node-level `mutates_checkout: false`)  —  couverture : **natif**

- YAML / CLI : `nodes[].allowed_tools: [Read, Grep, Glob]; nodes[].settingSources: []; nodes[].skills: []; nodes[].mutates_checkout: false; nodes[].hooks.PreToolUse[].response.hookSpecificOutput.permissionDecision: deny`

```yaml
  - id: judge
    command: review-diff
    context: fresh
    allowed_tools: [Read, Grep, Glob]   # cannot write or run shell
    settingSources: []                  # no CLAUDE.md / user hooks: clean context
    skills: []
    mutates_checkout: false             # engine fails the node if the checkout changed
    hooks:
      PreToolUse:
        - matcher: "Bash|Write|Edit"
          response:
            hookSpecificOutput:
              hookEventName: PreToolUse
              permissionDecision: deny
              permissionDecisionReason: "Judge is read-only"
```
- Ce qui manque ou diffère : `hooks`, `settingSources`, `sandbox` are Claude-only; `allowed_tools`/`denied_tools` unsupported on Codex (warn and continue). YAML hooks are static responses only; no `agent:`/`prompt:` hook type exists, so the judge cannot itself be a hook.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:750-772`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:395-407`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:236`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:254`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:150-181`, `packages/docs-web/src/content/docs/guides/hooks.md:59-77`, `packages/docs-web/src/content/docs/guides/hooks.md:387-399`, `packages/docs-web/src/content/docs/guides/hooks.md:421-426`, `packages/docs-web/src/content/docs/guides/skills.md:164-191`, `packages/docs-web/src/content/docs/reference/configuration.md:291-320`


### B-fresh-judge.4 Per-node provider / model / effort / system prompt for the judge  —  couverture : **natif**

- YAML / CLI : `nodes[].provider, nodes[].model, nodes[].effort, nodes[].systemPrompt, nodes[].maxBudgetUsd (Claude only); `archon workflow run <name> --dry-run` prints each node's effective provider/model`

```yaml
  - id: judge
    prompt: "Independent review of $diff.output"
    context: fresh
    provider: codex          # different vendor than the implementer
    model: large
    effort: high
    systemPrompt: "You are a strict reviewer. Decide only; do not fix."
    output_format:
      type: object
      properties: { ok: { type: boolean } }
      required: [ok]
```
- Ce qui manque ou diffère : Nothing for model choice. Caveat: `context: { resume: ... }` requires source and consumer on the same provider; a cross-vendor judge must therefore be `context: fresh` (which is the intent anyway).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:199-201`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:242-258`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:327-331`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1750-1753`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:66-81`, `packages/docs-web/src/content/docs/reference/cli.md:343`


### B-fresh-judge.5 Fix/judge loop: `loop_group` with fresh reviewer, `until_bash` on the verdict field, `$LOOP_PREV` feedback, named owner session for the worker  —  couverture : **natif**

- YAML / CLI : `nodes[].loop_group: { max_iterations, fresh_context, until_bash: 'test $review.output.done = true', nodes: [...] }; body node `context: { resume: <pre-loop node> }` (owner) and `context: fresh` (reviewer); `$LOOP_PREV.<review>.output.<field>``

```yaml
  - id: corrections
    depends_on: [implement]
    loop_group:
      max_iterations: 3
      fresh_context: true
      until_bash: 'test $review.output.done = true'
      nodes:
        - id: owner
          context: { resume: implement }
          prompt: "Fix: $LOOP_PREV.review.output.reasons"
        - id: review
          depends_on: [owner]
          context: fresh
          prompt: Review the change and report whether it is ready.
          output_format: { type: object, properties: { done: { type: boolean }, reasons: { type: string } }, required: [done, reasons], additionalProperties: false }
```
- Ce qui manque ou diffère : Failure resume restarts the group at iteration 1 (no per-iteration cursor); only the immediately previous iteration is reachable through `$LOOP_PREV`; `until_field`/`output_format` are not allowed on the group itself (read the body node's field through `until_bash`). `max_iterations` is mandatory, so an unconvinced judge ends in node failure, not an endless loop.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:784-830`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:543-604`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:712-768`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:340-355`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:229-285`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:846-866`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:313`


### B-fresh-judge.6 Self-judged loop completion (`loop:` + `until_field`)  —  couverture : **partiel**

- YAML / CLI : `nodes[].loop.until_field: <boolean property of nodes[].output_format>`

```yaml
  - id: triage
    output_format:
      type: object
      properties: { done: { type: boolean } }
      required: [done]
    loop:
      prompt: Work the next item. Report whether the backlog is now empty.
      max_iterations: 20
      until_field: done
```
- Ce qui manque ou diffère : The judgment is made by the same agent that did the work (same loop node, threaded session unless `fresh_context: true`), so it is not a second agent in a clean context. Use `loop_group` with a separate `context: fresh` reviewer node for an independent judge.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:287-343`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:308-311`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:212-227`


### B-fresh-judge.7 Reusable judge block with a recorded verdict: `inputs:` / `returns:` / `outcome_field:` composed via `include:` or run as a `workflow:` child; workflow-level `mutates_checkout: false`  —  couverture : **natif**

- YAML / CLI : `workflow-level `inputs:`, `returns: <node-id>`, `outcome_field: <boolean field>`, `mutates_checkout: false`; caller node `include: <name>` + `with:` or `workflow: <name>` + `with:`/`input:` + `isolation:`; `archon workflow get <run-id> --json` (outcome, terminal_record)`

```yaml
name: judge-block
description: Independent verdict on a diff; composes or runs alone
mutates_checkout: false
inputs:
  diff: { required: true }
returns: verdict
outcome_field: green
nodes:
  - id: verdict
    prompt: "Judge $INPUTS.diff. Set green only if it meets the intent."
    context: fresh
    allowed_tools: [Read, Grep]
    output_format: { type: object, properties: { green: { type: boolean }, notes: { type: string } }, required: [green, notes], additionalProperties: false }
```
- Ce qui manque ou diffère : `outcome_field` records the verdict (`outcome: succeeded|failed`) but never changes lifecycle status, resume, or exit codes; an included block's outcome does not propagate to the composer and a `workflow:` child's outcome stays on its own run row, so the caller must still gate on `$judge.output.green` with `when:`. `workflow:` children cannot be used inside a `loop_group` body (only `include:`).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1992`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1703-1759`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1803-1830`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2200`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2218-2232`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2430-2447`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2845`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2934-2958`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:689-710`, `packages/docs-web/src/content/docs/reference/cli.md:623-660`, `packages/docs-web/src/content/docs/guides/global-workflows.md:56-103`


### B-fresh-judge.8 Judge as selector among parallel attempts (collector node pattern; fan_out `all_done` + script reduce)  —  couverture : **partiel**

- YAML / CLI : `parallel `prompt:` nodes feeding one `prompt:` collector with `trigger_rule: none_failed_min_one_success`; or `workflow:`/`include:` + `fan_out: { items, as, max_parallel, join: all_done }` then a `script:` node reducing `$fan.output``

```yaml
  - id: attempt-a
    prompt: "Solve $ARGUMENTS using the existing helper."
    model: large
  - id: attempt-b
    prompt: "Solve $ARGUMENTS from scratch."
    model: medium
  - id: pick
    prompt: "Two attempts. Choose the better and explain why.\n\nA:\n$attempt-a.output\n\nB:\n$attempt-b.output"
    context: fresh
    depends_on: [attempt-a, attempt-b]
    trigger_rule: none_failed_min_one_success
    output_format: { type: object, properties: { choice: { type: string, enum: [A, B] } }, required: [choice] }
```
- Ce qui manque ou diffère : Pattern only: no built-in multi-judge voting, scoring rubric, or threshold join (the docs deliberately refuse a 'K of N' join and say judgement belongs in a node). Aggregating several fresh judges requires a `script:` reducer.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2600-2635`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2522-2598`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2461-2521`


### B-fresh-judge.9 Inline sub-agent judge (`agents:` + Task tool)  —  couverture : **partiel**

- YAML / CLI : `nodes[].agents.<kebab-id>: { description, prompt, model?, tools?, disallowedTools?, skills?, maxTurns? }; main node needs `allowed_tools` including `Task``

```yaml
  - id: implement-and-check
    prompt: |
      Implement the change, then spawn the `judge` sub-agent on the diff
      and return its JSON verdict unchanged.
    allowed_tools: [Bash, Read, Write, Edit, Task]
    agents:
      judge:
        description: Independent reviewer of a diff
        prompt: "Review the diff you are given. Return JSON { ok, reasons }."
        model: opus
        tools: [Read, Grep]
```
- Ce qui manque ou diffère : Claude only (Codex warns and ignores). The judge is spawned by the agent whose work it judges, so independence is weaker than a separate DAG node; its verdict only gates the DAG if the parent re-emits it through its own `output_format`; no engine record of the sub-agent's verdict.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:774-811`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:73`


### B-fresh-judge.10 Agent judge for paused runs: attention-queue handler workflow (`archon workflow attention` + `output_format` decision + `archon workflow respond`)  —  couverture : **partiel**

- YAML / CLI : `wait: { attention, form, labels }; `archon workflow attention --json --all --label <k>=<v>`; `archon workflow respond <run-id> <option> --occurrence <id> --json`; `archon workflow attention label <run-id> --occurrence <id> --set class=...``

```yaml
name: ci-other-handler
nodes:
  - id: queue
    bash: archon workflow attention --json --all --label ci=other
  - id: decide
    depends_on: [queue]
    prompt: "For every item decide whether retrying can succeed. $queue.output"
    output_format:
      type: object
      properties:
        answers: { type: array, items: { type: object, properties: { runId: { type: string }, occurrence: { type: string }, option: { type: string, enum: [retry, stop] } }, required: [runId, occurrence, option] } }
      required: [answers]
  - id: answer
    depends_on: [decide]
    bash: "... archon workflow respond \"$runId\" \"$option\" --occurrence \"$occ\" --json ..."
```
- Ce qui manque ou diffère : The judge runs as a separate scheduled/polled workflow, not inline in the DAG; it needs a trigger/schedule and your own `labels` convention; Archon never decides whether a person or an agent answers. Attention waits are unsupported in container-isolated runs.
- Citations : `packages/docs-web/src/content/docs/guides/attention-queue.md:205-273`, `packages/docs-web/src/content/docs/guides/attention-queue.md:275-303`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:12-16`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:851-870`, `packages/docs-web/src/content/docs/reference/cli.md:937-1010`


### B-fresh-judge.11 Human judge fallback: `wait: attention` with `form: approval` / `select`, reject-with-text rework loop  —  couverture : **partiel**

- YAML / CLI : `nodes[].wait: { attention: <msg>, form: approval|select|multi_select|message, options: [...] }; next node reads `$<wait>.output.decision` / `.text`; `archon workflow approve|reject|respond <run-id> [text]``

```yaml
  - id: human-gate
    depends_on: [judge]
    when: "$judge.output.verdict == 'unsure'"   # escalate only what the agent judge cannot settle
    wait:
      attention: "Agent judge is unsure: $judge.output.reasons"
      form: approval
  - id: ship
    depends_on: [human-gate]
    when: "$human-gate.output.decision == 'approve'"
    command: create-pr
```
- Ce qui manque ou diffère : This is the human (or CLI-driven agent) escalation, not an automatic second agent; it pauses the run durably. It is the right tail of the concept (final human verification), and a `when:` on the agent judge's verdict keeps it from firing on every run.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:21-66`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:67-141`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:143-175`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3548-3600`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3623-3655`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:605-687`


### B-fresh-judge.12 Testing the judge's gate deterministically: `archon workflow run --dry-run --stubs` and `archon validate workflows`  —  couverture : **partiel**

- YAML / CLI : `archon workflow run <name> --dry-run --stubs <file> [--stubs-init <file>] [--default-stubs] [--exec-code] --json; archon validate workflows [name] [--json]`

```yaml
cat > stubs.yaml <<'YAML'
judge:
  verdict: fail
  reasons: "missing tests"
YAML
archon workflow run ship-block --cwd . \
  --dry-run --stubs stubs.yaml --json | jq '.trace, .outcome, .authoredOutcome'
archon validate workflows ship-block   # warns on schemas lacking required/additionalProperties:false
```
- Ce qui manque ou diffère : Dry-run verifies the wiring (routing on a stubbed pass/fail verdict, authored outcome) but not the judge's judgement quality; Archon ships no eval harness, golden-set, or calibration tooling for judge prompts, and `workflow:` sub-runs are reported as unsupported in dry-run.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:408-447`, `packages/docs-web/src/content/docs/reference/cli.md:1492-1504`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:712-720`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3692-3715`


## C — Le bloc, brique réutilisable avec un contrat

Archon covers the "block" concept well on the structural side: a packaged workflow folder (`.archon/workflows/<pack>/<workflow>/` with its own `commands/`, `scripts/` and pack-level `.shared/`) is the physical Lego brick; `inputs:` / `returns:` / `outcome_field:` plus `output_format` on the returns node give it a typed caller-facing contract; `include:` (load-time inlining) and `workflow:` (governed child run, optionally in its own worktree, with `fan_out:`) make it callable from other workflows; bundled/global/repo precedence, `cp -R`, and `archon plugin add/update/copy` with `archon-plugin.json` (git tags as versions) make it copyable and versioned across projects. Its "own checks" are ordinary `bash:`/`script:` nodes, `until_bash`, `mutates_checkout: false` and schema-certified stdout, and they can be exercised without a model via `archon validate workflows`, `archon workflow run --dry-run --stubs` and `archon workflow test` (fixtures). What is missing is any first-class "VERIFIED" status or version field on a block (the docs state there is no verification node or status, and the plugin manifest forbids a version field), dynamic/cross-repo includes, and deep access to a block's internal nodes.


### C-block-unit.1 Packaged workflow layout (`.archon/workflows/<pack>/<workflow>/` with own `commands/`, `scripts/`, pack `.shared/`)  —  couverture : **natif**

- YAML / CLI : `Directory layout: `.archon/workflows/<pack>/<workflow>/<workflow>.yaml` + `commands/` + `scripts/`; `<pack>/.shared/` for modules; node fields `command: <name>`, `script: <name>``

```yaml
.archon/workflows/
└── my-pack/                 # pack (author-chosen)
    ├── .shared/result.ts    # modules shared by the pack's scripts
    └── review-block/        # one block = one folder
        ├── review-block.yaml
        ├── commands/review-diff.md
        └── scripts/check.ts
# review-block.yaml
name: review-block
nodes:
  - id: review
    command: review-diff     # resolves only from this block's commands/
  - id: check
    script: check            # resolves only from this block's scripts/
    runtime: bun
    depends_on: [review]
```
- Ce qui manque ou diffère : The folder is a self-contained, copyable unit (same tree works in repo and `~/.archon/workflows/`), but the pack has no version/identity metadata of its own; imports across packs and npm dependencies are outside the packaged-module contract (script-nodes.md:160).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:46-66`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:206-215`, `packages/docs-web/src/content/docs/guides/script-nodes.md:151-204`, `packages/docs-web/src/content/docs/reference/configuration.md:33`, `README.md:259`


### C-block-unit.2 `include:` node (load-time composition of another workflow as a namespaced sub-DAG)  —  couverture : **natif**

- YAML / CLI : `Node fields `include: <workflow-name>`, `with: {name: value}`, optional `fan_out:`; caller reads `$<includeId>.output``

```yaml
nodes:
  - id: plan
    prompt: Plan the requested change.
  - id: review
    include: reusable-review     # another workflow file, found by name
    depends_on: [plan]
    with:
      plan: $plan.output
      base_branch: main
  - id: summary
    prompt: "Summarize $review.output"   # the block's returns: node
    depends_on: [review]
```
- Ce qui manque ou diffère : Phase-1 non-goals: no deep access to the block's internal nodes (only `$includeId.output`), literal names only (no `include: $something`, no cross-repo includes), nesting capped at 3 levels, no `workflow:` child inside a `loop_group` body. Run-owned fields (`worktree`, `container`, `evidence_policy`, `budget`, `mutates_checkout`) declared in the block are dropped with a warning.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:230`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1703-1734`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1736-1759`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1761-1801`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1803-1857`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1899-1915`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:689-710`


### C-block-unit.3 `workflow:` node (governed child sub-run) with `isolation: worktree` and `fan_out:`  —  couverture : **natif**

- YAML / CLI : `Node fields `workflow: <name>`, `input: <string>` or `with: {…}`, `isolation: inherit|worktree`, `fan_out: {items, as, max_parallel, join}``

```yaml
nodes:
  - id: plan
    prompt: "Plan the change described in $ARGUMENTS."
  - id: implement-qa
    workflow: qa-block          # separate run record, artifacts, cost, gates
    with:
      plan: "$plan.output"
      mode: fast
    isolation: worktree         # its own checkout and branch
    depends_on: [plan]
  - id: summarize
    prompt: "Result:\n\n$implement-qa.output"
    depends_on: [implement-qa]
```
- Ce qui manque ou diffère : `retry:` is not allowed on a `workflow:` node; not usable inside a `loop_group` body; `--dry-run` reports sub-runs as unsupported instead of simulating them (cli.md:445); concurrent children sharing one checkout collide on the path lock unless the child declares `mutates_checkout: false`.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:231`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2216`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2218-2240`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2303-2330`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2407-2460`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2461-2530`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2727-2806`


### C-block-unit.4 Workflow signature: `inputs:`, `returns:`, `outcome_field:` and `$INPUTS` / `INPUTS_<UPPER_SNAKE>`  —  couverture : **natif**

- YAML / CLI : `Workflow-level `inputs: {name: {required, default, description}}`, `returns: <node-id>`, `outcome_field: <boolean-field>`; CLI `archon workflow run <name> --input name=value``

```yaml
name: review-block
description: Building block - reviews a diff; composes into a parent, also runs alone
inputs:
  diff: { required: true, description: the diff to review }
  style: { default: strict }
returns: synthesize          # this node's output IS the block's result
outcome_field: green         # boolean verdict persisted as run outcome
nodes:
  - id: gather
    prompt: Gather context for $INPUTS.diff (style $INPUTS.style).
  - id: synthesize
    prompt: Synthesize a review from $gather.output; report green.
    depends_on: [gather]
    output_format:
      type: object
      properties: { review: { type: string }, green: { type: boolean } }
      required: [review, green]
```
- Ce qui manque ou diffère : Inputs are untyped (only `required`/`default`/`description`; CLI values are plain strings); chat platforms have no channel for inputs (#2555); `outcome_field` cannot select a `loop_group` or a fan-out `workflow:` node; an included block's `outcome_field` never propagates to the composer.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:150-159`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1992`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2012-2027`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2028-2043`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2087-2135`, `packages/docs-web/src/content/docs/reference/cli.md:342`, `packages/docs-web/src/content/docs/reference/variables.md:185-249`


### C-block-unit.5 Result contracts: `output_format` on the `returns:` node (AI or bash/script) and `archon_artifact` pointers  —  couverture : **natif**

- YAML / CLI : `Node field `output_format: <JSON Schema>` (valid on `prompt:`/`command:`/`bash:`/`script:`/`loop:`); reserved object `{type: archon_artifact, run_id, path}``

```yaml
# plan-block.yaml - a deterministic producer owns the contract
name: plan-block
returns: build
nodes:
  - id: build
    script: build-plan-result    # writes $ARTIFACTS_DIR/plan.md, prints JSON
    runtime: uv
    output_format:
      type: object
      properties:
        units: { type: array, items: { type: object } }
        plan:
          type: object
          properties: { type: { const: archon_artifact }, run_id: { type: string }, path: { type: string } }
          required: [type, run_id, path]
      required: [units, plan]
```
- Ce qui manque ou diffère : A `workflow:` caller cannot add its own schema (load error) and an `include:` caller's schema is ignored; a fan-out aggregate has no per-field contract (consume the whole array); a pointer may only name the producing run's own artifacts.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:245`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2825`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2932`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2934-2958`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2960-3004`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3006-3062`, `packages/docs-web/src/content/docs/guides/script-nodes.md:276-318`, `packages/docs-web/src/content/docs/reference/variables.md:251-289`


### C-block-unit.6 Deterministic checks packaged inside the block: `bash:`/`script:` nodes, `until_bash`, `mutates_checkout: false`, `evidence_policy`  —  couverture : **partiel**

- YAML / CLI : `Node types `bash:`, `script:` + `runtime:`; `loop.until_bash` / `loop_group.until_bash`; node-level and workflow-level `mutates_checkout: false`; `evidence_policy: { required: true }``

```yaml
name: fix-block
mutates_checkout: false        # (workflow-level) skips the path lock when the block only reads
nodes:
  - id: fix-tests
    timeout: 900000
    loop:
      prompt: Run the test suite. Fix failures one at a time.
      max_iterations: 8
      until_bash: "bun run test"   # code decides when the agent is done
  - id: lint
    bash: bun run lint             # exit != 0 fails the node
    depends_on: [fix-tests]
    mutates_checkout: false        # (node-level) engine diffs git status before/after
```
- Ce qui manque ou diffère : Checks are ordinary DAG nodes; the docs state explicitly "There is no special verification node or verification status" (authoring-workflows.md:2007-2010). `evidence_policy` only checks that `$ARTIFACTS_DIR/evidence.json` exists, not that a check ran. Nothing marks a block as verified; `mutates_checkout` is run-owned and dropped when the block is included.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:214-215`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:232`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2431-2460`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:229-262`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:433-466`, `packages/docs-web/src/content/docs/guides/hooks.md:59-77`


### C-block-unit.7 Testing a block's own wiring without a model: `archon workflow run --dry-run --stubs/--stubs-init/--default-stubs/--exec-code` and `archon workflow test` (declared fixtures)  —  couverture : **partiel**

- YAML / CLI : ``archon workflow run <name> --dry-run --stubs <file> [--input k=v] [--exec-code] [--json]`; `archon workflow run <name> --dry-run --stubs-init <file>`; `archon workflow test [<name>|<folder>|<path>]` (fixtures/*.stubs.yaml)`

```yaml
# scaffold a fixture from the expanded (include-flattened) DAG
archon workflow run review-block --cwd . --dry-run --stubs-init fixtures/green.stubs.yaml
# simulate routing/joins/strict fields, inputs resolved as in a real run
archon workflow run review-block --cwd . --dry-run \
  --stubs fixtures/green.stubs.yaml --input diff="$(git diff)" --json | jq '.outcome, .authoredOutcome'
# run the block's bash/script checks for real inside the simulation
archon workflow run review-block --cwd . --dry-run --stubs fixtures/green.stubs.yaml --exec-code
# run every declared fixture of a workflow, folder or pack; exit 1 on any failure
archon workflow test review-block
archon workflow test my-pack
```
- Ce qui manque ou diffère : Dry-run validates deterministic engine wiring, not model reasoning (cli.md:449); runtime `workflow:` sub-runs are reported as unsupported; the fixture file format (`fixtures/*.stubs.yaml`, `expect`) is only mentioned in CLI help/CHANGELOG, not in the Markdown reference, and the `@archon/workflows` package holding the fixture runner is absent from this copy.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:351-356`, `packages/docs-web/src/content/docs/reference/cli.md:408-449`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1986-1991`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:95-114`, `packages/cli/src/help.ts:321-323`, `packages/cli/src/commands/workflow.ts:1377-1407`, `CHANGELOG.md:304`, `CHANGELOG.md:350`


### C-block-unit.8 `archon validate workflows [name]` (static validation of the block and its referenced resources)  —  couverture : **natif**

- YAML / CLI : ``archon validate workflows [name] [--json]`; `archon validate commands [name]``

```yaml
archon validate workflows                 # all workflows
archon validate workflows review-block    # one block
archon validate workflows review-block --json
# checks: YAML, DAG cycles/refs, command files, MCP configs, skill dirs,
# provider compatibility, model refs, INPUTS_* env reads, output_format schemas
```
- Ce qui manque ou diffère : Static only; does not execute checks or assert outcomes. For bundled/global workflows `@custom` model aliases are rejected as non-portable.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1492-1517`, `packages/docs-web/src/content/docs/guides/script-nodes.md:370-385`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2820-2822`, `packages/docs-web/src/content/docs/guides/global-workflows.md:252-256`


### C-block-unit.9 Scope precedence and copy-by-folder: bundled < `~/.archon/workflows/` (global) < repo `.archon/workflows/`; `cp -R` of a pack; same-name override  —  couverture : **natif**

- YAML / CLI : `Directories `~/.archon/workflows/` (or `$ARCHON_HOME/workflows/`) and `<repo>/.archon/workflows/`; `cp -R /path/to/Archon/.archon/workflows/sdlc .archon/workflows/`; `archon workflow list``

```yaml
# copy the whole pack (its workflows include each other and share .shared/)
cp -R /path/to/Archon/.archon/workflows/sdlc .archon/workflows/
# or make a block available to every project on this machine
mkdir -p ~/.archon/workflows
cp -R .archon/workflows/my-pack ~/.archon/workflows/
archon workflow list --cwd .     # bundled + global + repo; repo wins by name
```
- Ce qui manque ou diffère : Copying is a plain filesystem copy: no provenance, no upstream link, no version stamp; a block used purely as a building block still shows in `archon workflow list` (mark it in `description:`).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:34-44`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:66-70`, `packages/docs-web/src/content/docs/guides/global-workflows.md:12-30`, `packages/docs-web/src/content/docs/guides/global-workflows.md:40-58`, `packages/docs-web/src/content/docs/guides/global-workflows.md:60-67`, `packages/docs-web/src/content/docs/guides/global-workflows.md:206-220`, `packages/docs-web/src/content/docs/book/essential-workflows.md:281`, `packages/docs-web/src/content/docs/reference/cli.md:263-277`


### C-block-unit.10 Installed workflow packs (plugins): `archon-plugin.json` + `archon plugin add|update|remove|copy|list`, identity `owner/plugin:entrypoint`, support workflows, runs frozen at a commit  —  couverture : **natif**

- YAML / CLI : ``archon-plugin.json` fields `schemaVersion`, `kind: workflow-pack`, `name`, `description`, `compatibility.archon`, `entrypoints`; CLI `archon plugin add owner/repo[/path]@<tag>`, `archon plugin update <id>[@<tag>]`, `archon plugin copy <id>`, `archon plugin remove <id>`, `archon plugin list``

```yaml
{
  "schemaVersion": 1,
  "kind": "workflow-pack",
  "name": "review-kit",
  "description": "Review workflows",
  "compatibility": { "archon": ">=0.11.0" },
  "entrypoints": { "review": "review/review.yaml" }
}
# versions are git tags
archon plugin add acme/review-kit@v1.0.0
archon workflow run acme/review-kit:review
archon plugin update acme/review-kit@v1.1.0
archon plugin copy acme/review-kit    # -> ./.archon/workflows/review-kit/ (now yours)
```
- Ce qui manque ou diffère : Manifest is strict: no `version`, dependencies, install scripts or permission grants (publishing-plugins.md:24) - versioning is git tags only, no semver range resolution between packs; private repositories cannot be installed (manifest read unauthenticated); support workflows cannot be dispatched or reused by another pack; a project copy is detached from updates.
- Citations : `packages/docs-web/src/content/docs/guides/global-workflows.md:69-109`, `packages/docs-web/src/content/docs/reference/cli.md:167-194`, `packages/docs-web/src/content/docs/guides/publishing-plugins.md:8-33`, `packages/docs-web/src/content/docs/reference/archon-directories.md:57`, `packages/docs-web/src/content/docs/reference/archon-directories.md:94-100`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2545-2549`


### C-block-unit.11 Frozen workflow source per run (pinned digest, `workflow-source/runs/<run-id>/`) and `--workflow-source`  —  couverture : **partiel**

- YAML / CLI : ``archon workflow run <name> --workflow-source <dir> --cwd <target>`; storage `~/.archon/workspaces/<project>/workflow-source/runs/<run-id>/``

```yaml
# author the block in one checkout, run it against another, source frozen at start
archon workflow run review-block \
  --workflow-source ~/dev/blocks \
  --cwd ~/checkouts/target "review the auth change"
# every continuation replays the captured source; edits need a fresh run
archon workflow resume <run-id>
```
- Ce qui manque ou diffère : Pins the exact bytes a run executed (reproducibility/audit), but is not a block version identity you can name or share; detection is checkpoint-based, not sealing.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:334`, `packages/docs-web/src/content/docs/reference/cli.md:378-406`, `packages/docs-web/src/content/docs/guides/script-nodes.md:206-211`, `packages/docs-web/src/content/docs/reference/archon-directories.md:51`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1998-1999`


### C-block-unit.12 Block lifecycle metadata: `description:` conventions, `tags:`, `deprecated:`  —  couverture : **partiel**

- YAML / CLI : `Workflow-level `description: |`, `tags: [..]`, `deprecated: { message: ... }``

```yaml
name: review-block
description: |
  BUILDING BLOCK - do not run standalone.
  **Use when**: composed by archon-review-like parents
  **Produces**: structured review verdict (green: boolean)
tags: [Review, Block]
deprecated:
  message: Use review-kit:review instead.
```
- Ce qui manque ou diffère : No `verified`/status field, no version field; `deprecated:` is metadata-only and `tags:` only drive Web UI filtering. The 'VERIFIED badge' has to be a description/tag convention.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:145-166`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1913-1915`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3269-3282`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3284-3312`, `packages/docs-web/src/content/docs/reference/cli.md:273-292`


### C-block-unit.13 Typed artifacts (`output_type`) and `$TYPED_ARTIFACTS_FILE` for locating a block's deliverables by type  —  couverture : **partiel**

- YAML / CLI : `Node field `output_type: <label>`; env/variable `$TYPED_ARTIFACTS_FILE`; sidecars `$ARTIFACTS_DIR/nodes/<id>.md` + `<id>.meta.json``

```yaml
nodes:
  - id: planner
    command: plan-feature
    output_type: plan          # downstream reads artifactsByType["plan"]
  - id: consume
    script: |
      const l = JSON.parse(require('fs').readFileSync(process.env.TYPED_ARTIFACTS_FILE,'utf8'));
      console.log(JSON.stringify(l.artifactsByType['plan'] ?? []));
    runtime: bun
    depends_on: [planner]
```
- Ce qui manque ou diffère : Best-effort sidecar (may be absent); an observation of what existed when the node started, not a contract; labels are free-form conventions.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1440-1492`, `packages/docs-web/src/content/docs/reference/archon-directories.md:35-40`


### C-block-unit.14 Per-block execution config travels with the block (`provider`, `model`, `effort`, `skills`, `plugins`, `hooks`, `mcp`, `allowed_tools`)  —  couverture : **natif**

- YAML / CLI : `Workflow-level `provider:`, `model:`, `effort:`; node-level `provider`, `model`, `skills: [..]`, `plugins: [..]`, `hooks:`, `mcp:`, `allowed_tools``

```yaml
# research-block.yaml - runs on exactly this, whoever composes it
name: research-block
provider: codex
model: large
effort: high
nodes:
  - id: research
    prompt: Research $INPUTS.topic
    skills: [code-conventions]
    allowed_tools: [Read, Grep]
# archon workflow run parent --dry-run shows each node's effective provider/model
```
- Ce qui manque ou diffère : `webSearchMode` is the one workflow-level field that cannot travel with a composed block; `hooks:` is Claude-only and static (no executable hook types in YAML).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1711-1716`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1736-1759`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:236-260`, `packages/docs-web/src/content/docs/guides/skills.md:164-192`, `packages/docs-web/src/content/docs/guides/hooks.md:23-57`, `packages/docs-web/src/content/docs/reference/cli.md:451-460`


### C-block-unit.15 Skills as deliverables (`skills:` + `SKILL.md`, `npx skills add`, `archon skill add`)  —  couverture : **partiel**

- YAML / CLI : `Node field `skills: [name]`; files `.claude/skills/<name>/SKILL.md` or `~/.claude/skills/`; CLI `npx skills add <owner/repo>`, `archon skill add [path]``

```yaml
.claude/skills/my-skill/
└── SKILL.md
---
name: my-skill
description: What this skill does and when to use it
---
# Instructions
...
# in a block:
nodes:
  - id: implement
    prompt: "Write the code"
    skills: [my-skill]
```
- Ce qui manque ou diffère : A skill is provider-native procedural knowledge, not an Archon block: no inputs/outputs contract, no checks, no composition; installed outside `.archon/` and delivery differs per provider (Codex uses explicit `$skill-name`).
- Citations : `packages/docs-web/src/content/docs/guides/skills.md:12-22`, `packages/docs-web/src/content/docs/guides/skills.md:124-162`, `packages/docs-web/src/content/docs/guides/skills.md:164-192`, `packages/docs-web/src/content/docs/reference/cli.md:1594-1613`


### C-block-unit.16 Global shared helpers (`~/.archon/scripts/`, `~/.archon/commands/`) for legacy/shared workflows  —  couverture : **partiel**

- YAML / CLI : `Directories `~/.archon/scripts/<name>.ts|.py`, `~/.archon/commands/<name>.md`; node fields `script: <name>`, `command: <name>` in non-packaged workflows`

```yaml
# ~/.archon/scripts/triage-fmt.ts  (available to every repo)
# ~/.archon/commands/review-checklist.md
nodes:
  - id: review
    command: review-checklist
  - id: format
    script: triage-fmt
    runtime: bun
    depends_on: [review]
```
- Ce qui manque ou diffère : Only for flat/legacy workflows: packaged workflows never fall through to shared scopes, so a reusable helper for a packaged block must live in the block's own `scripts/` or the pack's `.shared/`.
- Citations : `packages/docs-web/src/content/docs/guides/global-workflows.md:12-30`, `packages/docs-web/src/content/docs/guides/global-workflows.md:185-204`, `packages/docs-web/src/content/docs/guides/script-nodes.md:423-445`, `packages/docs-web/src/content/docs/guides/script-nodes.md:151-158`


## D — Un bloc n'est fini que vérifié, contrôles testés

Archon covers the "bounded" half of this concept natively and well: every `loop:`/`loop_group:` requires `max_iterations`, `retry.max_attempts` is capped at 1-5, `timeout`/`idle_timeout` bound wall time, `maxBudgetUsd` caps one Claude node and a run-level `budget:` (`max_work_units`/`max_spend_usd`) refuses new attempts, while measured `spend.tokens`/`spend.costUsd`/`spend.numTurns` and `diagnostics.loopIterations` are persisted per node and readable via `archon workflow get --json --verbose`. The "verified" half is only approximated: deterministic checks (`until_bash`, `bash:`/`script:` with `output_format`, `outcome_field`), an `evidence_policy` that checks file presence only, retained `exec_output` evidence in the transcript, and `archon workflow test` / `--dry-run --stubs --exec-code` fixtures that exercise a block's wiring (the closest thing to "tests for the tests"). The docs state outright that there is no verification node, verification status or badge, nothing compares or optimizes cost across runs, and the run budget cannot be declared on workflows containing loops, sub-runs or fan-out includes; the bundled sdlc pack YAMLs are absent from this copy.


### D-block-verified.1 Loop iteration bound (`max_iterations` on `loop:` / `loop_group:`)  —  couverture : **natif**

- YAML / CLI : `loop.max_iterations / loop_group.max_iterations (required); failure recorded as lifecycle.failureKind = "max_iterations", diagnostics.maxIterations / diagnostics.loopIterations`

```yaml
nodes:
  - id: fix-tests
    timeout: 900000            # ms budget for each until_bash check
    loop:
      prompt: Run the test suite, read the failures, fix them one at a time.
      max_iterations: 8        # Required. Node FAILS (not succeeds) when reached
      until_bash: "bun run test"
      fresh_context: false
```
- Ce qui manque ou diffère : Bounds iterations only, not tokens or dollars per iteration. A terminal `wait: attention` in a loop_group body permits one more iteration per answer even past the bound (loop-nodes.md:640-642). Retries inside an iteration do not consume max_iterations.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:47`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:96`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:201-206`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:518`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:537`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3711-3713`, `packages/docs-web/src/content/docs/book/quick-reference.md:211`, `packages/docs-web/src/content/docs/book/quick-reference.md:238`, `packages/docs-web/src/content/docs/reference/node-execution.md:294`, `packages/docs-web/src/content/docs/reference/node-execution.md:343-348`


### D-block-verified.2 Deterministic completion channels (`until_bash`, `until_field`, bash/script check nodes in a `loop_group` body)  —  couverture : **natif**

- YAML / CLI : `loop.until_bash / loop.until_field / loop_group.until_bash reading `$node.output.<field>`; `$LOOP_PREV.<node>.output``

```yaml
- id: fix-loop
  loop_group:
    until_bash: test $test.output = "green"   # only a green check ends the loop
    max_iterations: 5
    nodes:
      - id: implement
        prompt: |
          Previous attempt's test output: $LOOP_PREV.test.output
          Fix what failed.
      - id: test
        bash: if bun test; then printf 'green'; else printf 'red'; fi
        depends_on: [implement]
```
- Ce qui manque ou diffère : The check itself is never tested by Archon (no harness proving `until_bash` goes red on a known-bad state). Channels are OR'd: if a prose `until:` is also declared, the model can end the loop before the bash check disagrees (loop-nodes.md:456-466), so `until:` must be omitted for a truly deterministic gate.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:60-72`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:76-82`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:229-258`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:287-320`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:433-466`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:552-571`, `packages/docs-web/src/content/docs/book/dag-workflows.md:341`


### D-block-verified.3 Retry policy (`retry:` block) with bounded attempts and typed failure classification  —  couverture : **natif**

- YAML / CLI : `retry.max_attempts (1-5, required when retry: is declared), retry.delay_ms, retry.on_error: transient|all; audit event node_retry_scheduled`

```yaml
- id: deploy                 # bash/script retry ONLY with an explicit retry: block
  bash: "./deploy.sh"
  retry:
    max_attempts: 3          # retries after the first attempt (1-5)
    delay_ms: 5000
    on_error: all
- id: iterate
  retry: { max_attempts: 1, delay_ms: 0 }   # loops: budget resets per iteration
  loop:
    prompt: "Finish the task and output <promise>DONE</promise>"
    until: DONE
    max_iterations: 5
```
- Ce qui manque ou diffère : Rate-limit and capacity failures always get at least five retries regardless of max_attempts (authoring-workflows.md:976). `retry:` is rejected on `loop_group:`. Loops accept only on_error: transient.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:910-918`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:952-960`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:962-970`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:976-978`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:998-1000`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:523-541`, `packages/docs-web/src/content/docs/book/quick-reference.md:267-275`, `packages/docs-web/src/content/docs/guides/script-nodes.md:110-113`


### D-block-verified.4 Run budgets (workflow-level `budget:`)  —  couverture : **partiel**

- YAML / CLI : `budget.max_work_units (integer) and/or budget.max_spend_usd (USD); exit reason budget_refused, event run_budget_refused; node field spend.costUsd.partial`

```yaml
name: bounded-block
budget:
  max_work_units: 20   # one unit = one started attempt of a prompt/command/bash/script node
  max_spend_usd: 5     # provider-reported cost; an attempt with unknown cost FAILS the run
nodes:
  - id: implement
    command: implement-changes
  - id: check
    bash: bun test
    depends_on: [implement]
```
- Ce qui manque ou diffère : A budgeted workflow may not contain `loop:`, `loop_group:`, `workflow:` or `include:` with `fan_out:` (load error), so the iterative blocks this concept describes cannot carry a run budget. Budget is run-owned: an included block's `budget:` is dropped. No run-tree-wide ceiling across sub-runs (tracked in #1961). Overshoot by the cost of attempts already running.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:146-149`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1047-1105`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1747`, `packages/docs-web/src/content/docs/book/quick-reference.md:122`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2509-2520`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2634-2640`


### D-block-verified.5 Per-node USD cap (`maxBudgetUsd`)  —  couverture : **partiel**

- YAML / CLI : `maxBudgetUsd: <number> on a command:/prompt: node (Claude only, per-node only); failure class budget_exceeded is FATAL (never retried)`

```yaml
- id: expensive-step
  command: generate
  provider: claude
  maxBudgetUsd: 2.50   # node fails if exceeded; Claude only, per-node only
```
- Ce qui manque ou diffère : Claude only (Codex and others warn and ignore it); cannot be set at workflow level; ignored on bash/script nodes; not applied to loop iterations as a whole.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:254`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:329`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:348-354`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:968`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3734`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:74`, `packages/docs-web/src/content/docs/guides/script-nodes.md:130-131`


### D-block-verified.6 Time bounds: `timeout` / `on_timeout` (bash, script, until_bash) and `idle_timeout` (AI nodes)  —  couverture : **natif**

- YAML / CLI : `timeout: <ms> (default 120000), on_timeout: skip, idle_timeout: <ms> (default 30 min); failureKind timeout is TRANSIENT and retried`

```yaml
- id: implement
  command: implement-changes
  idle_timeout: 600000       # ms without a provider chunk -> node fails (transient, retried)
- id: typecheck
  bash: bun run type-check
  timeout: 300000            # ms before SIGTERM to the process tree; default 120000
  on_timeout: skip           # optional: skipped instead of failed
  depends_on: [implement]
```
- Ce qui manque ou diffère : No whole-node or whole-run wall-clock deadline for AI nodes (idle_timeout measures silence, and each retry may wait a full idle_timeout again). Processes that ignore SIGTERM or leave the process group can outlive the timeout.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:214-215`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:233`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:261-284`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:998`, `packages/docs-web/src/content/docs/guides/script-nodes.md:98-99`, `packages/docs-web/src/content/docs/guides/script-nodes.md:122-123`, `packages/docs-web/src/content/docs/guides/script-nodes.md:132-133`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:247-258`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:475`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:520`, `packages/docs-web/src/content/docs/book/quick-reference.md:151`, `packages/docs-web/src/content/docs/book/quick-reference.md:165`


### D-block-verified.7 Sub-agent turn cap (`maxTurns` on inline `agents:` definitions)  —  couverture : **partiel**

- YAML / CLI : `agents.<id>.maxTurns (Claude only)`

```yaml
- id: implement
  command: implement-changes
  agents:
    checker:
      description: Runs the checks and reports failures
      prompt: Run bun test and report only the failures.
      tools: [Bash, Read]
      maxTurns: 10
```
- Ce qui manque ou diffère : Only for inline Claude sub-agents invoked via the Task tool; there is no `maxTurns` on a command:/prompt: node itself. Turn count is reported (spend.numTurns) on Claude only but not enforced at node level.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:800`


### D-block-verified.8 Measured usage records (spend.tokens / spend.costUsd / spend.numTurns / diagnostics.loopIterations) exposed by `archon workflow get` and the API  —  couverture : **partiel**

- YAML / CLI : `archon workflow get <run-id> --json --verbose [--events]; GET /api/workflows/runs/{runId}; node fields spend.tokens.value.{input,output,total,cost}, spend.costUsd.{value,partial}, spend.numTurns, diagnostics.loopIterations, diagnostics.maxIterations, accounting`

```yaml
archon workflow get <run-id> --json --verbose            # per-node summaries with execution metadata (spend.*)
archon workflow get <run-id> --json --verbose --events   # durable event envelopes (cost_usd with cost_scope)
curl http://localhost:3090/api/workflows/runs/<run-id>   # run.terminal_record + serialized events
```
- Ce qui manque ou diffère : Observation only: nothing compares runs, stores a baseline, or flags regressions (no 'optimized' notion). Provider-dependent: cost reported by Claude/OpenCode/Pi only, turn count by Claude only; Archon never estimates cost. A `tokensUnknown` interval makes run totals unavailable.
- Citations : `packages/docs-web/src/content/docs/reference/node-execution.md:3`, `packages/docs-web/src/content/docs/reference/node-execution.md:22-28`, `packages/docs-web/src/content/docs/reference/node-execution.md:45-52`, `packages/docs-web/src/content/docs/reference/node-execution.md:241-262`, `packages/docs-web/src/content/docs/reference/node-execution.md:272-281`, `packages/docs-web/src/content/docs/reference/node-execution.md:343-348`, `packages/docs-web/src/content/docs/reference/cli.md:623-630`, `packages/docs-web/src/content/docs/reference/cli.md:699-703`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:74-78`


### D-block-verified.9 Evidence gate (`evidence_policy: { required: true }`)  —  couverture : **partiel**

- YAML / CLI : `workflow-level evidence_policy.required: true; requires host file $ARTIFACTS_DIR/evidence.json before completion; event evidence_validation_failed; run-owned (dropped on include)`

```yaml
name: verified-block
evidence_policy:
  required: true        # run fails unless $ARTIFACTS_DIR/evidence.json exists at completion
nodes:
  - id: check
    bash: |
      bun test && printf '{"tests":"green","at":"%s"}' "$(date -u +%FT%TZ)" > "$ARTIFACTS_DIR/evidence.json"
```
- Ce qui manque ou diffère : File-presence convention only: any contents, including a self-asserted claim, satisfy it; it proves neither that a check ran nor what it found. Run-owned, so a reusable block cannot carry its own evidence requirement when included.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1747`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3190`, `packages/docs-web/src/content/docs/guides/container-isolation.md:106`, `CHANGELOG.md:553`


### D-block-verified.10 Retained subprocess evidence (`exec_output` transcript rows, `node_completed.data.node_output`) via `archon workflow logs`  —  couverture : **partiel**

- YAML / CLI : `archon workflow logs <run-id> [--follow]; transcript ~/.archon/workspaces/<project>/logs/<run-id>.jsonl; rows: step, content (<bash>|<script>|<until_bash>), exit_code, stdout_tail, stderr_tail`

```yaml
archon workflow logs <run-id>            # exact JSONL; one exec_output row per bash/script/until_bash run
archon workflow logs <run-id> --follow   # stay attached while the run executes
# row fields: step, content, exit_code (0 | code | ENOENT | SIGTERM), stdout_tail, stderr_tail (last 2000 chars)
```
- Ce qui manque ou diffère : Evidence that a check ran and how it exited, capped at 2000 chars per stream, credentials redacted; it is an audit trail, not a verification verdict or badge, and nothing consumes it automatically.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1490-1492`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1494-1527`, `packages/docs-web/src/content/docs/reference/cli.md:763-780`, `packages/docs-web/src/content/docs/guides/script-nodes.md:85-89`


### D-block-verified.11 Result contracts and authored verdict (`output_format` on bash/script/AI nodes, `returns:`, `outcome_field:`, `terminal_record`)  —  couverture : **partiel**

- YAML / CLI : `output_format (JSON Schema; stdout certified on bash:/script:), returns: <node-id>, outcome_field: <boolean property>; persisted outcome succeeded|failed independent of lifecycle status; archon workflow get <run-id> --json -> terminal_record`

```yaml
name: review-block
returns: verdict
outcome_field: green          # exact true -> outcome: succeeded, false -> failed
nodes:
  - id: verdict
    bash: 'if bun test; then printf ''{"green":true}''; else printf ''{"green":false}''; fi'
    output_format:            # stdout must be one schema-valid JSON document or the node FAILS
      type: object
      properties: { green: { type: boolean } }
      required: [green]
```
- Ce qui manque ou diffère : The authored outcome is a self-reported verdict and 'does not control lifecycle status'; the docs state 'There is no special verification node or verification status'. outcome_field cannot select a loop_group or fan-out node. Nothing marks the block itself as verified across runs.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:245`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1990`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2825`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2827-2840`, `packages/docs-web/src/content/docs/reference/cli.md:447`


### D-block-verified.12 Deterministic dry-run fixtures and `archon workflow test` (tests for the block's wiring and checks)  —  couverture : **partiel**

- YAML / CLI : `archon workflow run <name> --dry-run [--stubs <path>] [--stubs-init <path>] [--default-stubs] [--exec-code] [--json]; archon workflow test [<pack-or-workflow>] [--json] (exit 1 on any failing fixture)`

```yaml
archon workflow run my-block --cwd . --dry-run --stubs-init fixtures/my-block.yaml
archon workflow run my-block --cwd . --dry-run --stubs fixtures/my-block.yaml --default-stubs --exec-code --json
archon workflow test my-block --json   # runs every declared dry-run fixture of the block
archon workflow test sdlc              # or a whole pack by name or directory path
```
- Ce qui manque ou diffère : 'This validates deterministic engine wiring; it does not validate model reasoning' (cli.md:449). AI nodes are always stubbed; bash/script check nodes run only with --exec-code. The fixture file format and its `expect` checks are referenced (authoring-workflows.md:1990, cli.md:441) but not documented in this copy, and the `@archon/workflows` fixture-runner package is absent from the copy. No mutation-style proof that a check fails on bad input.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:351-356`, `packages/docs-web/src/content/docs/reference/cli.md:408-447`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1755`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1989-1990`, `packages/cli/src/cli.ts:516-521`, `packages/cli/src/commands/workflow.ts:1377-1384`, `CHANGELOG.md:304`, `CHANGELOG.md:350`, `CHANGELOG.md:428-429`, `CONTRIBUTING.md:59-66`, `AGENTS.md:171`


### D-block-verified.13 Static validation (`archon validate workflows`)  —  couverture : **partiel**

- YAML / CLI : `archon validate workflows [name] [--json]; checks YAML, DAG, command/MCP/skill resources, model refs, and the retry:, loop:, loop_group:, worktree:, container:, evidence_policy: blocks; compiles every output_format; enforces until_field's four load-time rules`

```yaml
archon validate workflows my-block --json   # exit 0 = valid, 1 = errors; WARNING [parse_warning] for dropped keys
archon workflow list                        # same parse warnings inline under each workflow
```
- Ce qui manque ou diffère : Lint-level only: proves the block loads and its bounds are well-formed, not that its checks or budgets are adequate. Warnings for an included block are reported against the included file, not the composer.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1492-1503`, `packages/docs-web/src/content/docs/reference/cli.md:1648-1651`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3170-3190`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2823-2825`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:312-320`


### D-block-verified.14 Per-node hooks as in-node quality loop and hard stop (`hooks:` PostToolUse/PreToolUse, `continue: false`, `decision: block`)  —  couverture : **partiel**

- YAML / CLI : `hooks.PostToolUse[].response.hookSpecificOutput.additionalContext; hooks.PreToolUse[].response.hookSpecificOutput.permissionDecision: deny; response.continue: false; response.decision: block (Claude only)`

```yaml
- id: implement
  command: implement-changes
  hooks:
    PostToolUse:
      - matcher: "Write|Edit"
        response:
          hookSpecificOutput:
            hookEventName: PostToolUse
            additionalContext: "Re-read the file, run bun run type-check, fix errors before continuing."
```
- Ce qui manque ou diffère : Claude only; 'It doesn't guarantee the model complies' (book/hooks-and-quality.md:142). Hooks are not passed through to loop iterations (loop-nodes.md:484-490). Prompt pressure, not a deterministic verdict.
- Citations : `packages/docs-web/src/content/docs/book/hooks-and-quality.md:70`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:116-142`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:185`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:211-212`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:220`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:234`


### D-block-verified.15 Bundled verification blocks: `archon-validate` and `archon-review` (sdlc pack)  —  couverture : **partiel**

- YAML / CLI : `archon workflow run archon-validate --no-worktree [--input scope=<package or check>]; archon workflow run archon-review --input scope=<PR|empty> [--input light=true] [--input prior_report=<path>]`

```yaml
archon workflow run archon-validate --no-worktree --input scope=core   # runs the project's own checks, structured verdict, fixes nothing
archon workflow run archon-review --input scope=87 --branch fix/login-redirect   # evidence-based verdict against the stated contract
```
- Ce qui manque ou diffère : These verify a code change, not a workflow block; their YAML lives in `.archon/workflows/sdlc/` of the upstream repo and is absent from this copy, so their internal checks could not be read. They judge once per run and carry no badge.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:13`, `packages/docs-web/src/content/docs/book/essential-workflows.md:192-194`, `packages/docs-web/src/content/docs/book/essential-workflows.md:215-221`, `packages/docs-web/src/content/docs/guides/index.md:41`, `packages/docs-web/src/content/docs/guides/index.md:61`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:38-40`


### D-block-verified.16 Fan-out cost bounding (`fan_out.max_parallel` vs `items`)  —  couverture : **partiel**

- YAML / CLI : `workflow: <name> + fan_out.items / fan_out.max_parallel / fan_out.join (all_done|all_success); cascade cancel capped at 500 descendants`

```yaml
- id: review-each
  workflow: review-block
  fan_out:
    items: $plan.output.parts   # cost = items.length -> bound the list in the producer node
    max_parallel: 4             # concurrency window, NOT a count limit
    join: all_success
```
- Ce qui manque ou diffère : No cap on child count or on run-tree spend: 'a 200-item fan-out over a child that fails on item 1 still costs 200 children'; the budget ceiling across a run tree is an open issue (#1961). Bounding must be done in the producer.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:222`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2509-2520`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2634-2640`


## E — Un bloc par métier, emboîtables

Archon's bundled `sdlc` pack already ships one block per trade named in the concept: `archon-triage` (triage), `archon-investigate` (research), `archon-plan` (design), `archon-validate` (deterministic testing), `archon-review` (judge/report), plus `archon-implement`, `archon-pr`, `archon-deliver` and `archon-ship`, the last being the canonical chain (triage -> investigate|plan -> deliver -> outcome) built from `include:` nodes gated by `when: "$triage.output.route == ..."`. Chaining is a first-class engine feature: `include:` (load-time flattening), `workflow:` (governed child run, optionally `isolation: worktree`), `fan_out:` (N copies), `inputs:`/`returns:`/`outcome_field:` (block signature), `output_format` result contracts and `$ARTIFACTS_DIR`/`output_type` artifact hand-offs between `context: fresh` nodes. What is missing is a generic non-code research/report block, a "VERIFIED" status for blocks, and the pack YAMLs themselves, which are absent from this repository copy.


### E-trade-blocks.1 Bundled sdlc pack: archon-triage (triage block)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-triage "#142" ; --input publish=true ; include: archon-triage ; $triage.output.route`

```yaml
# CLI
archon workflow run archon-triage "#142"
archon workflow run archon-triage --input publish=true "#142"
# as a block inside archon-ship (abridged from the book)
nodes:
  - id: triage
    include: archon-triage
  - id: inv
    include: archon-investigate
    depends_on: [triage]
    when: "$triage.output.route == 'investigate'"
```
- Ce qui manque ou diffère : Triage is GitHub-issue/plan oriented (reconciles an item with code, tracker history and direction, routes to investigate/plan/deliver/no action); it is not a generic task-classifier for non-code work. The YAML itself is absent from this copy.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:76-86`, `packages/docs-web/src/content/docs/book/essential-workflows.md:250`, `packages/docs-web/src/content/docs/book/how-it-works.md:23-31`, `packages/docs-web/src/content/docs/book/how-it-works.md:64`, `packages/docs-web/src/content/docs/guides/index.md:46`, `README.md:251`


### E-trade-blocks.2 Bundled sdlc pack: archon-investigate (research block)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-investigate "<question>" ; --detach ; verdict rooted|refuted|inconclusive ; include: archon-investigate`

```yaml
archon workflow run archon-investigate \
  "Why does the workflow list spin forever when no workflows exist?"
archon workflow run archon-investigate --detach "Investigate the flaky test"
# produces an evidence-backed report with verdict
# rooted | refuted | inconclusive; repository left untouched
```
- Ce qui manque ou diffère : Research is codebase root-cause research (bug/open question in the checkout); there is no bundled block for web/market/literature research.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:120-130`, `packages/docs-web/src/content/docs/book/first-five-minutes.md:56-61`, `packages/docs-web/src/content/docs/book/how-it-works.md:65`, `packages/docs-web/src/content/docs/getting-started/overview.md:280`, `packages/docs-web/src/content/docs/book/isolation.md:55`, `packages/cli/src/help.ts:993`


### E-trade-blocks.3 Bundled sdlc pack: archon-plan (design/plan block)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-plan "<intent>" ; --input report=<path> ; .archon/sdlc/policy/rulings.md ; include: archon-plan`

```yaml
archon workflow run archon-plan "Add CSV export to the reports page"
# build on a prior investigation report
archon workflow run archon-plan --input report=$ARTIFACTS_DIR/investigation.md "..."
# inside archon-ship (plan route)
  - id: planned
    include: archon-plan
    depends_on: [triage, intel]
    when: "$triage.output.route == 'plan'"
```
- Ce qui manque ou diffère : Plan artifact is a software plan (approach, rejected alternatives, verifiable steps, validation); design questions a person must answer stop the run (attention) unless a maintainer ruling in .archon/sdlc/policy/rulings.md already answers them.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:134-144`, `packages/docs-web/src/content/docs/book/how-it-works.md:38-41`, `packages/docs-web/src/content/docs/book/how-it-works.md:67`, `packages/docs-web/src/content/docs/getting-started/overview.md:283`, `packages/docs-web/src/content/docs/getting-started/overview.md:365`


### E-trade-blocks.4 Bundled sdlc pack: archon-validate (testing/validate block, deterministic)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-validate --no-worktree ; --input scope=<package or check>`

```yaml
archon workflow run archon-validate --no-worktree
archon workflow run archon-validate --no-worktree --input scope=packages/core
# Discovers and runs types/lint/tests/build, reports a structured verdict,
# judges nothing and fixes nothing.
```
- Ce qui manque ou diffère : It only reports; the fix-and-retry loop lives in archon-implement/archon-deliver (capped rounds). It validates the project's checks, not the workflow block's own checks (block self-testing is the dry-run/fixture machinery, see below).
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:215-225`, `packages/docs-web/src/content/docs/book/essential-workflows.md:260`, `packages/docs-web/src/content/docs/guides/index.md:56`, `README.md:258`


### E-trade-blocks.5 Bundled sdlc pack: archon-review (report/review block = judge in fresh context)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-review --input scope=<PR#|URL|''> --branch <head> ; --input light=true ; --input prior_report=<path> ; --input errors=true|false ; --input part=<json> ; context: fresh`

```yaml
archon workflow run archon-review --input scope=87 --branch fix/login-redirect
# continuation on a correction delta
archon workflow run archon-review --input prior_report=$ARTIFACTS_DIR/review.md \
  --input scope=87 --branch fix/login-redirect
# general reviewer only
archon workflow run archon-review --input light=true --input scope=87 --branch fix/login-redirect
```
- Ce qui manque ou diffère : The 'report' it produces is a synthesized code-review report posted as one PR comment (edited in place); there is no bundled generic reporting/digest block for stakeholders or for non-code deliverables.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:192-211`, `packages/docs-web/src/content/docs/book/essential-workflows.md:259`, `packages/docs-web/src/content/docs/book/how-it-works.md:70-71`, `packages/docs-web/src/content/docs/book/how-it-works.md:128`, `packages/docs-web/src/content/docs/reference/forge.md:139`


### E-trade-blocks.6 Bundled sdlc pack: archon-ship / archon-deliver (the canonical block chain)  —  couverture : **natif**

- YAML / CLI : `include: archon-triage|archon-investigate|archon-plan|archon-deliver ; when: "$triage.output.route == ..." ; trigger_rule: none_failed_min_one_success ; script: outcome ; archon workflow run archon-ship --branch <b> "#N"`

```yaml
name: archon-ship
nodes:
  - id: triage
    include: archon-triage
  - id: inv
    include: archon-investigate
    depends_on: [triage]
    when: "$triage.output.route == 'investigate'"
  - id: deliver
    include: archon-deliver
    depends_on: [triage, inv, planned]
    trigger_rule: none_failed_min_one_success
  - id: outcome
    script: outcome
    depends_on: [triage, deliver]
```
- Ce qui manque ou diffère : The chain is fixed to the SDLC (issue -> reviewed PR) and runs on GitHub via gh/forge; a different trade chain (e.g. research -> design -> report without code) has to be authored. The deliver tail caps at three implement/review rounds and never merges.
- Citations : `packages/docs-web/src/content/docs/book/how-it-works.md:17-56`, `packages/docs-web/src/content/docs/book/how-it-works.md:62-74`, `packages/docs-web/src/content/docs/book/how-it-works.md:80-86`, `packages/docs-web/src/content/docs/book/essential-workflows.md:50-70`, `packages/docs-web/src/content/docs/book/essential-workflows.md:176-186`, `README.md:250`, `README.md:256`


### E-trade-blocks.7 Other sdlc blocks: archon-implement, archon-pr, archon-upkeep, archon-intake, archon-build-queue, archon-discoveries  —  couverture : **partiel**

- YAML / CLI : `archon workflow run archon-implement --branch <b> "..." ; archon workflow run archon-pr --no-worktree --input draft=false ; archon-intake/archon-build-queue via trigger bindings ; mode: eval ; archon state get work/<n>`

```yaml
archon workflow run archon-implement --branch feat/export-csv \
  "Implement the plan in .archon/plans/csv-export.md"
archon workflow run archon-pr --no-worktree --input draft=false
archon workflow run archon-upkeep "Address the undici advisory"
# intake / build-queue / discoveries are started by trigger bindings
# (none installed by the pack); `mode: eval` writes nothing.
```
- Ce qui manque ou diffère : These cover build/PR/maintenance and the task-board front (intake -> build-queue), not the five named trades directly; intake/build-queue need you to add the trigger bindings described in the pack README, which is absent from this copy.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:90-116`, `packages/docs-web/src/content/docs/book/essential-workflows.md:148-172`, `packages/docs-web/src/content/docs/book/essential-workflows.md:231-241`, `packages/docs-web/src/content/docs/book/essential-workflows.md:247-261`, `packages/docs-web/src/content/docs/guides/index.md:45-57`


### E-trade-blocks.8 include: (load-time block composition, Lego brick)  —  couverture : **natif**

- YAML / CLI : `include: <workflow-name> ; depends_on ; when ; with: ; $<includeId>.output ; namespaced ids <includeId>__<nodeId> ; context: shared on entry node`

```yaml
nodes:
  - id: plan
    prompt: Plan the requested change.
  - id: review
    include: reusable-review
    depends_on: [plan]
    with:
      plan: $plan.output
      base_branch: main
  - id: summary
    prompt: "Summarize $review.output for the author."
    depends_on: [review]
```
- Ce qui manque ou diffère : Literal targets only (no include: $var, no cross-repo includes), depth capped at 3, parent reads only the block's terminal/returns output (no deep node access); `webSearchMode` does not travel with a block; `worktree`/`container`/`budget` are run-owned, so a block cannot pin its own isolation.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1703-1734`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1738-1759`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1761-1801`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1803-1827`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1899-1915`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:689-710`


### E-trade-blocks.9 Workflow signature: inputs: / returns: / outcome_field: (block contract)  —  couverture : **natif**

- YAML / CLI : `inputs: {name: {required|default|description}} ; returns: <node-id> ; outcome_field: <boolean prop> ; $INPUTS.<name> ; INPUTS_<UPPER_SNAKE> env ; archon workflow run <name> --input k=v`

```yaml
name: review-block
description: Reviews a diff. Building block; also runs on its own.
inputs:
  diff: { required: true, description: the diff to review }
  style: { default: strict }
returns: synthesize
outcome_field: green
nodes:
  - id: synthesize
    prompt: Review $INPUTS.diff (style $INPUTS.style); say if green.
    output_format:
      type: object
      properties: { review: { type: string }, green: { type: boolean } }
      required: [review, green]
```
- Ce qui manque ou diffère : Chat platforms (Slack/Telegram/Discord/GitHub) have no channel for inputs yet (#2555), so a required-input block cannot be launched from chat; `outcome_field` cannot select a loop_group or fan-out node. There is explicitly no verification node or verification status (authored outcome, lifecycle status and evidence marker are independent signals).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1991`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2012-2043`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2087-2129`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:154-159`, `packages/docs-web/src/content/docs/reference/cli.md:342`


### E-trade-blocks.10 workflow: sub-run (governed child block) with isolation: worktree and mutates_checkout: false  —  couverture : **natif**

- YAML / CLI : `workflow: <name> ; input: | with: ; isolation: inherit|worktree ; mutates_checkout: false (workflow-level) ; parent_run_id ; /workflow approve <childRunId>`

```yaml
nodes:
  - id: plan
    prompt: "Plan the change described in $ARGUMENTS."
  - id: refactor-module
    workflow: refactor-block
    input: "$plan.output"
    isolation: worktree        # own checkout, own branch
    depends_on: [plan]
  - id: review
    workflow: review-block     # declares mutates_checkout: false
    with: { plan: "$plan.output" }
    depends_on: [plan]
```
- Ce qui manque ou diffère : `retry:` is not allowed on a workflow: node; workflow: is unsupported inside a loop_group body; an isolated child is cut from the repo base branch (never sees the parent's uncommitted work or commits) and nothing merges it back; worktrees need a git repo project (folder projects fail fast).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2216`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2218-2237`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2303-2371`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2407-2459`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:135-145`, `packages/docs-web/src/content/docs/book/isolation.md:61-65`


### E-trade-blocks.11 fan_out: (N parallel copies of a block) on workflow: or include:  —  couverture : **natif**

- YAML / CLI : `fan_out: { items: "$node.output", as: <name>, max_parallel: N, join: all_done|all_success }`

```yaml
nodes:
  - id: pick-files
    bash: git diff --name-only origin/main | jq -R -s -c 'split("\n")|map(select(length>0))'
  - id: review-each
    workflow: review-one-file      # declares mutates_checkout: false
    depends_on: [pick-files]
    fan_out:
      items: "$pick-files.output"
      max_parallel: 3
  - id: summarize
    prompt: "Summarize these per-file reviews:\n\n$review-each.output"
    depends_on: [review-each]
```
- Ce qui manque ou diffère : No racing join (`first_success` rejected); composed (`include:` + `fan_out:`) blocks may not contain a wait/approval/interactive loop and cannot be isolated; cost scales with items.length and cascade-cancel caps at 500 children.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2461-2500`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2522-2560`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2727-2804`


### E-trade-blocks.12 Result contracts: output_format on the returns: node, artifact pointers (type: archon_artifact), script and agent interchangeable  —  couverture : **natif**

- YAML / CLI : `output_format: {type: object, properties, required} ; returns: ; $node.output.<field> ; { type: archon_artifact, run_id: $WORKFLOW_ID, path } ; archon workflow get <run-id> --json (terminal_record)`

```yaml
# plan-block.yaml: a deterministic producer owns the block's contract
name: plan-block
returns: build
nodes:
  - id: build
    script: build-plan-result
    runtime: uv              # writes $ARTIFACTS_DIR/plan.md
    output_format:
      type: object
      properties:
        units: { type: array, items: { type: object } }
        plan: { type: object, properties: { type: { const: archon_artifact }, run_id: { type: string }, path: { type: string } }, required: [type, run_id, path] }
      required: [units, plan]
```
- Ce qui manque ou diffère : A workflow: node cannot declare its own output_format (the child's returns: node owns it); fan-out aggregates allow no field access; artifact pointers are for machine readers (no in-workflow resolver, real-path checks at read time not yet implemented, #3160).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2825`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2827-2844`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2846-2898`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2932`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2934-2958`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2960-3004`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3006-3060`, `packages/docs-web/src/content/docs/guides/script-nodes.md:276-318`


### E-trade-blocks.13 Artifact chain between blocks: $ARTIFACTS_DIR, context: fresh, output_type sidecars, $TYPED_ARTIFACTS_FILE  —  couverture : **natif**

- YAML / CLI : `context: fresh ; output_type: <label> ; $ARTIFACTS_DIR/nodes/<id>.md + .meta.json ; $TYPED_ARTIFACTS_FILE (artifactsByType)`

```yaml
nodes:
  - id: planner
    command: plan-feature
    output_type: plan            # typed sidecar under $ARTIFACTS_DIR/nodes/
  - id: implement
    command: implement-plan
    depends_on: [planner]
    context: fresh
    # prompt: read $TYPED_ARTIFACTS_FILE, select artifactsByType["plan"],
    # open each entry's path under $ARTIFACTS_DIR
```
- Ce qui manque ou diffère : Typed sidecar write is best-effort (may be absent); the listing is an observation at invocation start, not a ledger; $STATE_DIR is not mounted in container runs.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1407-1438`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1440-1468`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1484-1490`, `packages/docs-web/src/content/docs/book/how-it-works.md:80-86`, `packages/docs-web/src/content/docs/book/how-it-works.md:124-132`, `packages/docs-web/src/content/docs/reference/variables.md:24-26`


### E-trade-blocks.14 Classify-and-route node pattern (generic triage block from nodes)  —  couverture : **natif**

- YAML / CLI : `output_format with enum ; when: "$classify.output.type == 'BUG'" ; trigger_rule: none_failed_min_one_success ; cancel: ; small model tier`

```yaml
nodes:
  - id: classify
    command: classify-issue
    model: small
    output_format:
      type: object
      properties: { type: { type: string, enum: [BUG, FEATURE] } }
      required: [type]
  - id: investigate
    command: investigate-bug
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"
  - id: implement
    depends_on: [investigate, plan]
    trigger_rule: none_failed_min_one_success
```
- Ce qui manque ou diffère : Nothing engine-side; the reference proactive-issue-investigation.yaml example is in the upstream repo's .archon/workflows/examples/, which is absent from this copy.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3442-3482`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3488-3516`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3601-3621`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:14-24`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:28-40`, `packages/docs-web/src/content/docs/guides/script-nodes.md:262-274`


### E-trade-blocks.15 Parallel review lenses + synthesize pattern (judge agents in clean context)  —  couverture : **natif**

- YAML / CLI : `multiple nodes with depends_on: [scope] and context: fresh ; a synthesize node depends_on all lenses ; agents: inline sub-agents`

```yaml
nodes:
  - id: scope
    command: create-review-scope
  - id: code-review
    command: code-review-agent
    depends_on: [scope]
    context: fresh
  - id: test-review
    command: test-coverage-agent
    depends_on: [scope]
    context: fresh
  - id: synthesize
    command: synthesize-reviews
    depends_on: [code-review, test-review]
    context: fresh
```
- Ce qui manque ou diffère : Inline `agents:` sub-agents are Claude-only (other providers warn and ignore); the bundled archon-review's route agent that picks lenses is inside the absent pack YAML.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3383-3418`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:774-809`, `packages/docs-web/src/content/docs/book/how-it-works.md:128-132`


### E-trade-blocks.16 Deterministic validate node patterns: bash:/script: checks and loop.until_bash  —  couverture : **natif**

- YAML / CLI : `bash: | script: (exit code governs node) ; output_format on a script ; loop: { until_bash: "bun run test", max_iterations } ; loop_group.until_bash`

```yaml
- id: fix-tests
  loop:
    prompt: Run the test suite. Read the failures. Fix them one at a time.
    max_iterations: 8
    until_bash: "bun run test"     # the only way out is a passing suite
    fresh_context: false
- id: gate
  bash: bun run typecheck && bun run lint
  depends_on: [fix-tests]
```
- Ce qui manque ou diffère : `until:` and `until_bash` are OR'd (an AI promise can end the loop while tests fail) unless you drop `until:`; a script whose stdout violates its own output_format is never retried.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:433-466`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2925`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1494-1527`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3623-3648`


### E-trade-blocks.17 Pack layout and distribution of blocks as code: .archon/workflows/<pack>/<workflow>/, .shared/, archon-plugin.json entrypoints, archon plugin add/copy  —  couverture : **natif**

- YAML / CLI : `.archon/workflows/<pack>/<workflow>/<workflow>.yaml + commands/ + scripts/ ; <pack>/.shared/ ; archon-plugin.json {kind: workflow-pack, entrypoints} ; archon plugin add owner/repo[/path][@tag] ; archon plugin copy <id> ; archon workflow run owner/plugin:entrypoint ; archon workflow list`

```yaml
review-kit/                 # plugin root
  archon-plugin.json        # {"kind":"workflow-pack","name":"review-kit",
                            #  "entrypoints":{"review":"review/review.yaml"}}
  .shared/util.ts           # modules scripts import
  review/review.yaml        # entrypoint block
  review/commands/scope.md
  review/scripts/check.ts
  helper/helper.yaml        # support block, only reachable via include:
# install / fork for one project
archon plugin add acme/review-kit@v1.2.0
archon workflow run acme/review-kit:review
archon plugin copy acme/review-kit   # -> ./.archon/workflows/review-kit/
```
- Ce qui manque ou diffère : Packs install only from public GitHub (manifest read unauthenticated); support workflows are not runnable standalone; copying one bundled workflow folder breaks because sdlc workflows include each other and share sdlc/.shared/ (copy the whole pack).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:46-66`, `packages/docs-web/src/content/docs/guides/global-workflows.md:38-62`, `packages/docs-web/src/content/docs/guides/global-workflows.md:64-103`, `packages/docs-web/src/content/docs/reference/cli.md:169-194`, `packages/docs-web/src/content/docs/reference/cli.md:278`, `packages/docs-web/src/content/docs/guides/index.md:61`, `packages/docs-web/src/content/docs/getting-started/overview.md:373`, `packages/docs-web/src/content/docs/book/essential-workflows.md:273-281`


### E-trade-blocks.18 Per-block model and provider choice (Opus/Sonnet/GPT per block)  —  couverture : **natif**

- YAML / CLI : `provider: / model: / effort: at workflow or node level travel with the included block ; model tiers small|medium|large ; archon workflow run --model large=codex/gpt-5.6-sol ; --dry-run prints effective provider/model`

```yaml
# review-block.yaml (composed block keeps its own choice)
name: review-block
provider: codex
model: large
effort: high
nodes:
  - id: scope
    command: scope
    model: small          # node value always wins
# rebind a tier for one run only
# archon workflow run archon-ship --model large=codex/gpt-5.6-sol "#142"
```
- Ce qui manque ou diffère : Built-in tier defaults exist only for claude and codex; `@alias` refs are rejected in bundled/global workflows; `webSearchMode` is workflow-level only and does not travel into a composed block.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1710-1715`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1741-1755`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3086-3105`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:195-203`, `packages/docs-web/src/content/docs/reference/cli.md:343`, `packages/docs-web/src/content/docs/reference/configuration.md:138`


### E-trade-blocks.19 Testing a block's own control flow: --dry-run with stubs, --stubs-init scaffolds, archon workflow test fixtures  —  couverture : **partiel**

- YAML / CLI : `archon workflow run <name> --dry-run --stubs <file> [--json] [--exec-code] [--default-stubs] ; --stubs-init <path> ; archon workflow test <name> ; archon validate workflows`

```yaml
# fixture for the triage route
cat > stubs.yaml <<'YAML'
classify: { route: investigate, reason: "a regression with a stack trace" }
investigate: { comment: "The cause is the null check in parser.ts" }
YAML
archon workflow run triage --dry-run --stubs stubs.yaml --json | jq '.trace,.outcome,.authoredOutcome'
archon workflow run deliver --dry-run --stubs-init fixtures/deliver.yaml
archon workflow test proactive-issue-investigation
archon validate workflows
```
- Ce qui manque ou diffère : Dry-run proves routing/joins/contracts with stubbed AI outputs, never the agent's real behaviour; `archon workflow test` with fixtures appears only in the proactive guide (no section in reference/cli.md); runtime workflow: sub-runs are reported unsupported in dry-run; there is no 'VERIFIED' status recorded on a block.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:351-356`, `packages/docs-web/src/content/docs/reference/cli.md:408-447`, `packages/docs-web/src/content/docs/reference/cli.md:1502`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:96-116`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3692-3716`


### E-trade-blocks.20 Router selection by description: (block discoverable by trade)  —  couverture : **natif**

- YAML / CLI : `description: | with 'Use when', 'NOT for', 'Produces', 'Steps' ; archon workflow list [name] --full --json ; mark building blocks in description`

```yaml
name: research-block
description: |
  Prove the root cause of a bug or open question.
  **Use when**: cause unknown, needs evidence before a fix
  **NOT for**: feature planning, PR review
  **Produces**: investigation.md with verdict rooted|refuted|inconclusive
  Building block: composed by ship-like workflows; also runs standalone.
```
- Ce qui manque ou diffère : Routing is by description text; a block used only as a building block still appears in `archon workflow list` and can be picked by the router unless its description says otherwise.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3284-3310`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1913-1915`, `packages/docs-web/src/content/docs/reference/cli.md:263-292`, `packages/docs-web/src/content/docs/getting-started/overview.md:375`, `packages/docs-web/src/content/docs/book/essential-workflows.md:17-42`


### E-trade-blocks.21 Read-only block declaration: worktree.enabled: false and --no-worktree for triage/report blocks  —  couverture : **natif**

- YAML / CLI : `worktree: { enabled: false } ; mutates_checkout: false ; archon workflow run <name> --no-worktree`

```yaml
name: triage-block
description: Read-only triage; never edits the checkout
worktree:
  enabled: false          # always run in the live checkout
mutates_checkout: false   # N runs may share one path
nodes:
  - id: triage
    command: triage
```
- Ce qui manque ou diffère : `worktree:` and `mutates_checkout:` are run-owned: when the block is composed with include:, the composing (top-level) workflow must declare them, a composed file's values are dropped with a warning.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:135-145`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2428-2454`, `packages/docs-web/src/content/docs/book/isolation.md:49-57`, `packages/docs-web/src/content/docs/reference/cli.md:339`


## F — Parallèle, un sandbox et un modèle par bloc

Archon covers the parallel + git-worktree half of this concept natively: nodes in the same DAG layer run concurrently and fan in through depends_on/trigger_rule; a `workflow:` child node with `isolation: worktree` gets its own worktree and branch, and `fan_out:` turns one such node into N governed children (max_parallel, join all_done/all_success, ordered aggregate output); every AI node can pick `provider:`/`model:`/`effort:` (Claude, Codex/GPT, Pi/Gemini, Copilot) or a portable `small|medium|large` tier rebound per run with `--model`. The sandbox half is only partial: container isolation exists but is Docker-overlay, folder-project-only and Claude-only in-container; there is no VM/remote backend (the type union reserves 'vm' | 'remote' but only worktree and container are implemented), no per-fan-out-child model choice, and nothing merges child worktrees back automatically.


### F-parallel-isolation.1 DAG topological layers (depends_on) — in-process fan-out / fan-in  —  couverture : **partiel**

- YAML / CLI : `nodes[].depends_on, nodes[].trigger_rule, nodes[].context: fresh, nodes[].mutates_checkout: false`

```yaml
nodes:
  - id: scope
    command: create-review-scope
  - id: code-review
    command: code-review-agent
    depends_on: [scope]
    context: fresh
  - id: security-review
    command: security-review-agent
    depends_on: [scope]
    context: fresh
  - id: synthesize
    command: synthesize-reviews
    depends_on: [code-review, security-review]
    trigger_rule: none_failed_min_one_success
```
- Ce qui manque ou diffère : All parallel nodes share the run's single checkout (one worktree per run, not per node); only `mutates_checkout: false` guards read-only siblings and a layer mixing guarded and unguarded nodes is serialized. `context: shared` is rejected in a parallel layer (use `context: fresh` or named `resume`). Fan-in is of text/JSON outputs via `$id.output`, not of code changes.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:109`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:224-225`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:286-312`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:449-456`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3383-3418`, `packages/docs-web/src/content/docs/book/dag-workflows.md:51-73`, `packages/docs-web/src/content/docs/getting-started/concepts.md:30`


### F-parallel-isolation.2 `workflow:` sub-run with `isolation: worktree` — one block, its own worktree and branch  —  couverture : **natif**

- YAML / CLI : `nodes[].workflow, nodes[].isolation: worktree | inherit, nodes[].input / nodes[].with`

```yaml
nodes:
  - id: plan
    prompt: "Plan the change described in $ARGUMENTS."
  - id: refactor-module
    workflow: refactor-block     # another workflow file = the block
    with: { plan: "$plan.output" }
    isolation: worktree          # its own checkout, its own branch
    depends_on: [plan]
  - id: test-module
    workflow: test-block
    with: { plan: "$plan.output" }
    isolation: worktree          # runs side by side with refactor-module
    depends_on: [plan]
```
- Ce qui manque ou diffère : Branch is cut from the repo base branch (not the parent's working tree) so inputs must travel via `input:`/`with:`/artifacts; nothing merges the child branch back (child must push/open a PR or a later node merges); requires a git repo project run via CLI/orchestrator (folder projects fail fast); `retry:` not allowed on a `workflow:` node; not allowed inside a `loop_group` body; child worktrees persist until `isolation cleanup`/`complete`.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:222`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2200`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2218-2240`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2303-2371`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2373-2405`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2407-2459`, `packages/docs-web/src/content/docs/reference/cli.md:501-506`, `packages/docs-web/src/content/docs/reference/cli.md:1374-1387`, `packages/docs-web/src/content/docs/book/isolation.md:59-65`, `packages/core/src/workflows/child-isolation-resolver.ts:6-20`


### F-parallel-isolation.3 `fan_out:` on a `workflow:` node — N governed child runs with bounded concurrency and join  —  couverture : **natif**

- YAML / CLI : `nodes[].fan_out.items, fan_out.as, fan_out.max_parallel, fan_out.join (all_done | all_success); combine with isolation: worktree`

```yaml
nodes:
  - id: pick-tasks
    bash: |
      cat tasks.json   # must print a JSON array
  - id: build-each
    workflow: implement-block
    depends_on: [pick-tasks]
    isolation: worktree           # one worktree + branch per child
    fan_out:
      items: "$pick-tasks.output"
      as: task                    # child reads $INPUTS.task
      max_parallel: 3
      join: all_done              # failed slots = { archon_failed: true, ... }
  - id: collect
    prompt: "Review results in item order:\n$build-each.output"
    depends_on: [build-each]
```
- Ce qui manque ou diffère : All children run the same child workflow, so model cannot vary per child (docs: a fan-out 'cannot express' attempts differing by model — use separate nodes instead); `join: first_success` (racing) is rejected at load and there is no K-of-N join (compute it in a `script:` node after `all_done`); worst-case spend is items.length children; abandon cascade caps at 500 descendants; no run-tree-wide budget ceiling yet (#1961).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2461-2504`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2506-2520`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2522-2545`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2552-2600`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2642-2660`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2662-2684`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2716-2725`


### F-parallel-isolation.4 `include:` + `fan_out:` — composed block fanned out inside one run (no child runs)  —  couverture : **partiel**

- YAML / CLI : `nodes[].include, nodes[].fan_out.items/as/max_parallel/join, nodes[].with`

```yaml
nodes:
  - id: pick-files
    bash: git diff --name-only origin/main | jq -R -s -c 'split("\n")|map(select(length>0))'
  - id: annotate-each
    include: annotate-file        # block with inputs:/returns: signature
    depends_on: [pick-files]
    fan_out:
      items: "$pick-files.output"
      as: file
      max_parallel: 3
  - id: collect
    prompt: "Merge these per-file annotations:\n\n$annotate-each.output"
    depends_on: [annotate-each]
```
- Ce qui manque ou diffère : No `isolation:` at all (instances share the parent checkout and must coordinate writes); no `wait:`/approval/interactive loop inside the block; one governance object only (no per-item run ids, cost lines or pauses).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2727-2806`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2164-2170`


### F-parallel-isolation.5 Per-node provider/model/effort choice and portable model tiers (Opus / Sonnet / GPT / Gemini per block)  —  couverture : **natif**

- YAML / CLI : `provider:, model:, effort:, fallbackModel: (workflow or node level); tiers:/aliases: in .archon/config.yaml; archon workflow run --model <name>=<spec>, --config <path>`

```yaml
# .archon/config.yaml
tiers:
  large:  { provider: claude, model: opus }
  medium: { provider: codex,  model: gpt-5.6-terra, effort: high }
  small:  { provider: pi,     model: google/gemini-2.5-pro }
# workflow
nodes:
  - id: implement
    command: implement
    model: large                 # Opus via tier
  - id: judge
    prompt: "Independently judge $implement.output"
    provider: codex
    model: gpt-5.6-sol           # literal id, GPT judge in a fresh context
    context: fresh
# per-run rebind: archon workflow run ship --model large=openai/gpt-5.6 "..."
```
- Ce qui manque ou diffère : Only claude and codex ship built-in tier defaults; other providers must configure each tier. No run-wide `--provider` flag (bind via tiers/aliases). Claude-only extras: `fallbackModel`, `maxBudgetUsd`, `sandbox`, `betas`. Child runs inherit the parent's recorded AI base, so a parent cannot override a specific child node's model except through the child's own YAML or tier bindings.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:195-198`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:242-243`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:250`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3064-3105`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3154-3165`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3235-3267`, `packages/docs-web/src/content/docs/reference/configuration.md:138-153`, `packages/docs-web/src/content/docs/reference/configuration.md:57`, `packages/docs-web/src/content/docs/reference/configuration.md:276-290`, `packages/docs-web/src/content/docs/reference/configuration.md:178-205`, `packages/docs-web/src/content/docs/reference/cli.md:343-344`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:779-782`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:19-32`


### F-parallel-isolation.6 Top-level run isolation: one worktree per `archon workflow run` (parallel runs on different branches)  —  couverture : **natif**

- YAML / CLI : `archon workflow run <name> --branch <b> | --no-worktree | --base <b> | --from <b> | --adopt <run-id>; workflow-level worktree.enabled; mutates_checkout: false`

```yaml
# two blocks as two top-level runs, each in its own worktree/branch
archon workflow run implement-block --cwd ~/app --branch feat/auth "Add OAuth"
archon workflow run implement-block --cwd ~/app --branch feat/export "Add CSV export"
# read-only block, shared checkout, many may coexist:
# workflow YAML
name: review-block
worktree:
  enabled: false
mutates_checkout: false
```
- Ce qui manque ou diffère : Worktrees are explicitly 'not an execution or security sandbox'; a path-exclusive lock cancels a second run on the same working path (not queued); `--base`/`--from` do not propagate to isolated sub-run children; same branch cannot run twice concurrently.
- Citations : `packages/docs-web/src/content/docs/book/isolation.md:11-57`, `packages/docs-web/src/content/docs/reference/cli.md:335-341`, `packages/docs-web/src/content/docs/reference/cli.md:462-476`, `packages/docs-web/src/content/docs/reference/cli.md:479-499`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:135-144`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1563-1589`, `packages/docs-web/src/content/docs/getting-started/concepts.md:88-101`, `packages/docs-web/src/content/docs/reference/cli.md:1665`, `packages/isolation/src/providers/worktree.ts:3-7`


### F-parallel-isolation.7 Worktree provisioning and placement config  —  couverture : **natif**

- YAML / CLI : `.archon/config.yaml: worktree.baseBranch, worktree.copyFiles, worktree.postCreate, worktree.postCreateTimeout, worktree.path, worktree.remote, worktree.initSubmodules`

```yaml
# .archon/config.yaml
worktree:
  baseBranch: main
  copyFiles: ['.env']
  postCreate:
    - bun install --frozen-lockfile
    - ./scripts/setup.sh
  postCreateTimeout: 300000
  path: .worktrees        # repo-local layout, visible in the IDE
  remote: origin
```
- Ce qui manque ou diffère : Provisioning runs only on creation (reused checkouts skip it); setup commands are not sandboxed; `copyFiles` is repo-config only.
- Citations : `packages/docs-web/src/content/docs/reference/configuration.md:233-251`, `packages/docs-web/src/content/docs/reference/configuration.md:339-356`, `packages/docs-web/src/content/docs/reference/configuration.md:362-372`, `packages/docs-web/src/content/docs/reference/configuration.md:453`, `packages/docs-web/src/content/docs/book/isolation.md:136-155`


### F-parallel-isolation.8 Worktree lifecycle management  —  couverture : **natif**

- YAML / CLI : `archon isolation list; archon isolation cleanup [days] [--merged] [--include-closed]; archon complete <branch> [--force]; archon workflow abandon <run-id>`

```yaml
archon isolation list                       # worktrees + containers, incl. child worktrees
archon isolation cleanup --merged           # remove worktrees whose PR merged
archon complete archon/task-3f9a1c2b-refactor-module-6fd3f873-child-0
archon workflow abandon <run-id>            # cancel tree, remove its worktree, keep branch
```
- Ce qui manque ou diffère : Cleanup must not run while a sub-run tree is still resumable (resume reuses the recorded worktree path and fails if gone).
- Citations : `packages/docs-web/src/content/docs/book/isolation.md:69-122`, `packages/docs-web/src/content/docs/reference/cli.md:1374-1402`, `packages/docs-web/src/content/docs/reference/cli.md:1532-1549`, `packages/docs-web/src/content/docs/reference/cli.md:1161-1166`, `packages/docs-web/src/content/docs/getting-started/concepts.md:94`


### F-parallel-isolation.9 Container isolation (Docker overlay sandbox, folder projects)  —  couverture : **partiel**

- YAML / CLI : `archon workflow run <name> --folder --container; config container.enabled/image/network/memoryMb/pidsLimit; workflow container.enabled, container.write_back: approve | auto`

```yaml
# .archon/config.yaml
container:
  image: archon-runner:latest
  network: none          # no egress
  memoryMb: 4096
  pidsLimit: 512
  enabled: true
# workflow YAML (run-owned, top-level only)
container:
  write_back: approve    # overlay diff gated before touching the live root
# bun run build:runner-image && archon workflow run my-block --folder --container "..."
```
- Ce qui manque ou diffère : Folder-project-only (a repo project errors; worktree and container are mutually exclusive backends); whole-run granularity (no per-node/per-block container); only Claude runs in-container (Codex/Pi/Copilot fail fast on the `containerExec` capability); no VM backend (types reserve 'vm' | 'remote' but only worktree + container are implemented); durable `wait:` nodes rejected and `archon state` unsupported in container runs; `$STATE_DIR` not mounted; pauses resumable from CLI only; native overlay mode is 'not a sandbox against a hostile agent'.
- Citations : `packages/docs-web/src/content/docs/guides/container-isolation.md:12-14`, `packages/docs-web/src/content/docs/guides/container-isolation.md:18-33`, `packages/docs-web/src/content/docs/guides/container-isolation.md:50-75`, `packages/docs-web/src/content/docs/guides/container-isolation.md:81-98`, `packages/docs-web/src/content/docs/guides/container-isolation.md:102-104`, `packages/docs-web/src/content/docs/reference/configuration.md:455-478`, `packages/docs-web/src/content/docs/reference/configuration.md:480-493`, `packages/docs-web/src/content/docs/reference/cli.md:341`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:904`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1598-1599`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1747`, `packages/docs-web/src/content/docs/guides/multi-repo-projects.md:12`, `packages/isolation/src/backends/container.ts:1-19`, `packages/isolation/src/backend-router.ts:5-10`, `packages/isolation/src/types.ts:5-6`, `packages/isolation/src/types.ts:23`


### F-parallel-isolation.10 Claude per-node `sandbox:` (OS-level filesystem/network restrictions)  —  couverture : **partiel**

- YAML / CLI : `nodes[].sandbox.enabled, sandbox.network.allowedDomains, sandbox.network.allowManagedDomainsOnly, sandbox.filesystem.denyWrite (also workflow level)`

```yaml
- id: untrusted-code-analysis
  command: analyze-external
  sandbox:
    enabled: true
    network:
      allowedDomains: []
      allowManagedDomainsOnly: true
    filesystem:
      denyWrite: ['/etc', '/usr']
```
- Ce qui manque ou diffère : Claude only (other providers warn and ignore); process-level restriction of the Claude subprocess, not a VM or container; keys are passthrough to the SDK and not validated by Archon.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:255`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:327-330`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:381-392`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3203-3205`


### F-parallel-isolation.11 Concurrency throttles and resource lanes for parallel blocks  —  couverture : **partiel**

- YAML / CLI : `concurrency.providers.<provider-id>: N, concurrency.maxConversations; trigger binding resource / capacity / overlap and launch.isolation { kind: default | in-place | worktree, branch }`

```yaml
# ~/.archon/config.yaml
concurrency:
  maxConversations: 10
  providers:
    pi: 1          # local GPU model: one attempt at a time
# trigger binding (JSON)
# "resource": "github:acme/widgets:build", "capacity": 2, "overlap": "queue",
# "launch": { "workflowName": "implement-block", "isolation": { "kind": "default" } }
```
- Ce qui manque ou diffère : Provider caps count attempts across the install, not per block; resource capacity applies to trigger-started root runs only (manual runs are invisible to admission); no per-node CPU/RAM quota outside the container backend.
- Citations : `packages/docs-web/src/content/docs/reference/configuration.md:119-130`, `packages/docs-web/src/content/docs/reference/configuration.md:166-174`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:12`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:95-110`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:186-199`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:325`


### F-parallel-isolation.12 Run budgets bounding parallel spend  —  couverture : **partiel**

- YAML / CLI : `budget.max_work_units, budget.max_spend_usd (workflow level); maxBudgetUsd (Claude node)`

```yaml
name: parallel-build
budget:
  max_work_units: 20
  max_spend_usd: 5
nodes:
  - id: expensive-step
    command: generate
    maxBudgetUsd: 2.50
```
- Ce qui manque ou diffère : `budget:` is run-owned (dropped on composed files) and there is no run-tree-wide ceiling across fan-out children yet (#1961); `maxBudgetUsd` is Claude-only.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:145-148`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:251`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:355-361`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2516-2520`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2636-2640`


## G — Déclencheur → tableau de tâches → écouteur

Archon covers the "trigger → durable queue → listener runs the blocks" half of this concept well: trigger bindings (native schedule, GitHub event source plugin, Standard Webhooks source, CLI `archon trigger fire` polling recipe) record a durable receipt, prepare the run, and admit it through a resource queue (`resource`/`capacity`/`overlap: queue`) that a host drains (`archon serve` with `ARCHON_TRIGGER_HOST`, or `archon trigger drain --host`), while `archon serve` / `archon workflow wake --watch` continue paused runs; the bundled `archon-intake` + `archon-build-queue` workflows plus `archon state` work items are the closest thing to a task board with a listener, and the attention queue (`archon workflow attention --json/--watch`, labels, handler workflows) is the documented "listener drains a queue" pattern. What is missing is a user-facing NEW/PICKED UP/DONE board (Archon's queue is a queue of starts and runs, inspected via `archon trigger list`, `archon workflow runs`, the console Runs page, with no editable columns), and phone/Slack/Telegram entry as a binding: chat adapters start conversational runs immediately with no admission, dedup or board, and vendor-signed webhooks (Slack/Telegram) are not accepted by the Standard Webhooks source, so a relay or poll script is needed. The bundled sdlc pack YAMLs (and the README holding the Intake/Build queue bindings) are absent from this copy.


### G-trigger-board-listener.1 Trigger bindings: native schedule (cron-style) binding file + `archon trigger schedule install`  —  couverture : **natif**

- YAML / CLI : `JSON binding file (e.g. `~/.archon/triggers/<name>.json`): `version`, `sourceInstanceId`, `binding.{bindingId, bindingRevision, hostId, runAsUserId, resource, capacity?, overlap, launch.{cwd, workflowName, inputs, isolation.kind}}`, `schedule.{intervalSeconds, runAtLoad}`; CLI `archon trigger whoami`, `archon trigger fire --config <file>`, `archon trigger schedule install|remove --config <file>``

```yaml
{
  "version": 1,
  "sourceInstanceId": "board-poll",
  "binding": {
    "bindingId": "board-listener", "bindingRevision": null,
    "hostId": "alice-macbook",
    "runAsUserId": "<id from: archon trigger whoami>",
    "resource": "board:listener", "overlap": "queue",
    "launch": { "cwd": "/abs/project", "workflowName": "board-listener",
                 "inputs": {}, "isolation": { "kind": "default" } }
  },
  "schedule": { "intervalSeconds": 300, "runAtLoad": true }
}
# archon trigger fire --config ~/.archon/triggers/board-poll.json   (test once)
# archon trigger schedule install --config ~/.archon/triggers/board-poll.json
```
- Ce qui manque ou diffère : Archon installs a scheduler only on macOS (LaunchAgent in the `com.archon.trigger.*` namespace, GUI login domain, no replay of missed intervals); on Linux/Windows the operator wires cron/systemd/Task Scheduler to run the same `archon trigger fire --config` one-shot. A schedule carries no event payload: the workflow's first node must find its own work (e.g. read a board) and keep a cursor in a durable state document. Schedules and bindings are deployment config, not workflow YAML.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:12-21`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:75-83`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:85-128`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:130-156`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:158-164`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:166-182`, `packages/docs-web/src/content/docs/reference/cli.md:77-91`, `packages/cli/src/commands/trigger.ts:36-50`, `packages/cli/src/triggers/native-schedule.ts:8-18`


### G-trigger-board-listener.2 GitHub event starts (source plugin bindings with `selector` + `inputMapping`)  —  couverture : **natif**

- YAML / CLI : `Server env `ARCHON_WEBHOOK_SOURCES=<abs path to sources.json>`, `ARCHON_TRIGGER_HOST=<hostId>`, `WEBHOOK_SECRET`; sources file `sources[].{sourceInstanceId, module, config.{version, host, bindings[], webhookSecretEnv}}`; binding `selector.{kind: issue.lifecycle|pr.lifecycle|label|comment.changed|..., actions, repository.{host,path}, predicates[]}`, `inputMapping.<input>: {source: field, field} | {source: literal, value}`; GitHub webhook URL `https://<host>/webhooks/sources/<sourceInstanceId>``

```yaml
{ "version": 1, "sources": [ { "sourceInstanceId": "github-production",
  "module": "/opt/archon/plugins/github/source-plugin.mjs",
  "config": { "version": 1, "host": "github.com", "webhookSecretEnv": "WEBHOOK_SECRET",
    "bindings": [ { "bindingId": "issue-intake", "hostId": "build-host-1",
      "runAsUserId": "2a568f73-...", "resource": "github:acme/widgets:intake",
      "capacity": 3, "overlap": "queue",
      "launch": { "cwd": "/srv/archon/widgets", "workflowName": "proactive-issue-investigation",
                   "inputs": {}, "isolation": { "kind": "default" } },
      "selector": { "kind": "issue.lifecycle", "actions": ["opened"],
                     "repository": { "host": "github.com", "path": "acme/widgets" } },
      "inputMapping": { "issue_number": { "source": "field", "field": "subject.number" },
                         "repository": { "source": "literal", "value": "acme/widgets" } } } ] } } ] }
```
- Ce qui manque ou diffère : The plugin module must be built from a source checkout (`bun run --cwd packages/adapters build:github-source-plugin`) and copied to an operator plugin directory; marketplace install is separate work. Supported events: issue/PR lifecycle, label changes, issue/PR comments created (comment text not included), check-run and commit-status changes. Without a GitHub delivery ID there is no replay dedup; GitHub does not auto-redeliver failures.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:211-219`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:221-282`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:283-289`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:42-74`, `packages/docs-web/src/content/docs/reference/security.md:133-151`


### G-trigger-board-listener.3 Standard Webhooks source (start from any signed webhook)  —  couverture : **partiel**

- YAML / CLI : `Source config `signingSecretEnv`, `bindings[].inputMapping: {"<input>": "/rfc6901/pointer"}`; sender URL `https://<host>/webhooks/sources/<sourceInstanceId>` with headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 hmac>`; env `ARCHON_WEBHOOK_SOURCES`, `ARCHON_TRIGGER_HOST``

```yaml
{ "version": 1, "sources": [ { "sourceInstanceId": "tasks-production",
  "module": "/opt/archon/plugins/standard-webhooks/source-plugin.mjs",
  "config": { "version": 1, "signingSecretEnv": "TASKS_SIGNING_SECRET",
    "bindings": [ { "bindingId": "process-task", "hostId": "tasks-host",
      "runAsUserId": "2a568f73-...", "resource": "tasks:processing", "overlap": "queue",
      "launch": { "cwd": "/srv/archon/tasks", "workflowName": "process-task",
                   "inputs": {}, "isolation": { "kind": "in-place" } },
      "inputMapping": { "task_id": "/task/id" } } ] } } ] }
# workflow must declare:  inputs: { task_id: { type: string, required: true } }
```
- Ce qui manque ou diffère : Only the Standard Webhooks v1 HMAC-SHA256 scheme is accepted: vendor signatures (Slack signing secret, Telegram secret token, Discord, `svix-*` aliases, asymmetric keys) are unsupported, so a phone/Slack/Telegram sender needs a small relay that re-signs the event. `webhook-id` is the dedup key (409 on same id + different body). Mapped inputs are untrusted and persisted with the receipt; no retention policy.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:291-336`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:338-359`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:361-369`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:371-375`, `packages/adapters/src/sources/standard-webhooks/source-plugin.ts:1-14`


### G-trigger-board-listener.4 Polling recipe for systems without webhooks (`archon trigger fire --delivery-id --inputs` + `archon trigger drain`)  —  couverture : **partiel**

- YAML / CLI : ``archon trigger fire --config <binding.json> --delivery-id <base64 [id,version]> --inputs <inputs.json>`; `archon trigger drain --host <hostId>`; run by host cron/systemd/launchd/Task Scheduler`

```yaml
#!/bin/sh
set -eu
curl --fail --silent "$BOARD_URL" | jq -c '.[] | select(.status=="NEW")' > items.jsonl
while IFS= read -r item; do
  delivery_id=$(printf '%s' "$item" | jq -er '[.id, .version] | @base64')
  printf '%s' "$item" | jq -cS '{task_id: .id}' > inputs.json
  /opt/archon/bin/archon trigger fire --config /srv/archon/board.json \
    --delivery-id "$delivery_id" --inputs inputs.json
done < items.jsonl
/opt/archon/bin/archon trigger drain --host tasks-host
```
- Ce qui manque ou diffère : Archon keeps no poll cursor, runs no resident poller and promises no catch-up: the operator script owns the lookback window and must keep scheduling drains on CLI-only hosts until queued work starts. The binding file still requires a `schedule` block even though `fire` ignores it. Only an identical key + inputs is deduplicated (stable JSON key order matters).
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:377-395`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:398-446`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:448-475`, `packages/docs-web/src/content/docs/reference/cli.md:83-84`


### G-trigger-board-listener.5 Durable resource admission queue (receipts, `resource`/`capacity`/`overlap`, `archon trigger list|inspect|withdraw|execute`)  —  couverture : **partiel**

- YAML / CLI : `Binding fields `resource` (string), `capacity` (default 1), `overlap: queue | skip`; CLI `archon trigger list [--limit]`, `archon trigger inspect <receipt-or-request-id>`, `archon trigger withdraw <request-id>`, `archon trigger execute <request-id> --host <hostId>`, `archon trigger recover-preparation <receipt> <binding> --owner <id> --yes`; run metadata `resource_start``

```yaml
"resource": "github:acme/widgets:build",
"capacity": 2,
"overlap": "queue"
# archon trigger list --limit 100        # recent receipts (NEW-ish)
# archon trigger inspect <request-id>    # disposition, blockers, recovery
# archon trigger withdraw <request-id>   # drop untouched queued work
# archon workflow runs --json --all      # admitted/running/paused/terminal
```
- Ce qui manque ou diffère : This is a durable FIFO of workflow starts (receipt → prepared → queued/skipped → admitted → run `pending|running|paused|completed|failed|cancelled`), not a human-facing task board: no NEW/PICKED UP/DONE columns, no editing, no UI beyond the console Runs page and `archon trigger list`. Admission is per `resource` with checkout hold-back rules; ambiguous ownership after a crash needs manual `archon workflow abandon`. No automatic trigger-record retention.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:184-195`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:197-209`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:477-483`, `packages/docs-web/src/content/docs/reference/cli.md:81-91`, `packages/core/src/db/resource-starts.ts:92-126`, `packages/core/src/db/resource-starts.ts:141-144`


### G-trigger-board-listener.6 Listener hosts: server with `ARCHON_TRIGGER_HOST`, `archon trigger drain`, and continuation hosts (`archon serve`, `archon workflow wake --watch`)  —  couverture : **natif**

- YAML / CLI : `Env `ARCHON_TRIGGER_HOST=<hostId>` on `archon serve`; `archon trigger drain --host <hostId>`; `archon workflow wake --watch --json`; `archon workflow wake schedule install --interval 5 --json` (macOS); Linux systemd `ExecStart=/abs/archon workflow wake --watch --json` + `Environment=ARCHON_HOME=...``

```yaml
# always-on listener (server host): prepares/starts webhook work as receipts commit,
# re-checks queued work every few seconds, and continues paused runs
ARCHON_TRIGGER_HOST=build-host-1 ARCHON_WEBHOOK_SOURCES=/etc/archon/sources.json \
  WEBHOOK_SECRET=... archon serve --port 3090

# CLI-only host: cold drain + continuation watcher
archon trigger drain --host build-host-1
archon workflow wake --watch --json
# or: archon workflow wake schedule install --interval 5 --json
```
- Ce qui manque ou diffère : Without `ARCHON_TRIGGER_HOST` the server records receipts but starts nothing. CLI-hosted execution runs each admitted run in a detached process and needs a scheduled drain plus a wake watcher; `wake` refuses container runs and external-platform conversations (manual `archon workflow resume`). The server package (`packages/server`) is not present in this copy of the repo.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:16-21`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:174-182`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:201-209`, `packages/docs-web/src/content/docs/reference/cli.md:1026-1045`, `packages/docs-web/src/content/docs/reference/cli.md:1047-1060`, `packages/docs-web/src/content/docs/reference/cli.md:1566-1583`, `packages/core/src/workflows/resource-start-host.ts:10-17`, `packages/core/src/workflows/resource-start-host.ts:325-331`, `packages/docs-web/src/content/docs/guides/attention-queue.md:200-203`


### G-trigger-board-listener.7 Bundled sdlc pack: `archon-intake` (trigger-started triage) + `archon-build-queue` (scheduled claim-and-ship) + work items in `archon state`  —  couverture : **partiel**

- YAML / CLI : ``archon workflow run archon-intake --input mode=eval "#142"`, `archon workflow run archon-build-queue --input mode=eval`; work items `archon state get work/<number>`, `archon state list --prefix work/`; policy file `.archon/sdlc/policy/maintainers.json`; labels `archon-needs-maintainer`, `archon-triage`, route labels; bindings shown in the SDLC pack README sections "Intake" and "Build queue" (pack installs none)`

```yaml
# board = GitHub issues + one state doc per issue; listener = schedule binding on archon-build-queue
archon state get work/142            # {trust, stage, triage fields, history}
archon state list --prefix work/     # every work item
archon workflow run archon-build-queue --input mode=eval   # dry decision replay
# binding.launch.workflowName: "archon-intake"      (issue + label event bindings)
# binding.launch.workflowName: "archon-build-queue" (schedule binding; claims one item per run)
```
- Ce qui manque ou diffère : The board is GitHub issues (labels + `work/<n>` state docs), not a generic NEW/PICKED UP/DONE board; the pack installs no trigger bindings (the README that shows them, and the pack YAML under `.archon/workflows/sdlc/`, are absent from this copy, so stage names and the exact binding JSON cannot be cited). Only maintainers' issues start agents. `build-queue` claims one item per scheduled run and pauses an attention item when unclear.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:90-96`, `packages/docs-web/src/content/docs/book/essential-workflows.md:100-106`, `packages/docs-web/src/content/docs/book/essential-workflows.md:110-116`, `packages/docs-web/src/content/docs/book/essential-workflows.md:251-253`, `packages/docs-web/src/content/docs/guides/index.md:39-61`, `packages/docs-web/src/content/docs/book/how-it-works.md:17`, `packages/cli/src/commands/doctor.ts:44-45`, `packages/docs-web/src/content/docs/reference/forge.md:196-209`


### G-trigger-board-listener.8 Durable state documents (`archon state`) as a DIY task board with revision-checked claims  —  couverture : **partiel**

- YAML / CLI : ``archon state put <name> --if-revision 0`, `archon state patch <name> [--if-revision <n>]` with stdin `{ops:[{op: set|remove|append, path: <JSON Pointer>, value}]}`, `archon state get|list --prefix|log|delete`, `--install` scope; inside nodes invoke `ARCHON_CLI_COMMAND` (JSON argv) with `WORKFLOW_ID`/`ARCHON_NODE_EXECUTION` provenance`

```yaml
nodes:
  - id: pick
    bash: archon state list --prefix board/ --json   # or your own listing
  - id: claim
    depends_on: [pick]
    runtime: bun
    with: { item: "$pick.output.next", rev: "$pick.output.revision" }
    script: |
      const cmd: string[] = JSON.parse(process.env.ARCHON_CLI_COMMAND!);
      const p = Bun.spawn([...cmd, 'state', 'patch', `board/${process.env.INPUTS_ITEM}`,
        '--if-revision', process.env.INPUTS_REV!], { stdin: 'pipe' });
      p.stdin.write(JSON.stringify({ops:[{op:'set',path:'/status',value:'PICKED UP'},
        {op:'set',path:'/run',value:process.env.WORKFLOW_ID}]}));
      p.stdin.end(); if (await p.exited !== 0) throw new Error('claim lost (exit 3 = someone else took it)');
```
- Ce qui manque ou diffère : No board UI, no columns, no notifications on state change: the board is a convention you write into JSON docs (≤64 KiB each) and read on demand (the engine never injects state into prompts). The claim is a convention built on `patch --if-revision` (exit 3 on conflict), not a lease; `archon state` is unavailable inside container-isolated runs; `$STATE_DIR` files have no locking at all.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1734-1800`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1594-1627`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1629-1668`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1681-1685`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1531-1561`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1563-1592`


### G-trigger-board-listener.9 Attention queue + handler workflows (`wait: attention` labels, `archon workflow attention --json/--watch`, `attention label`, `answer/respond`)  —  couverture : **partiel**

- YAML / CLI : ``wait: { attention: <msg>, form: message|approval|select|multi_select, options: [...], labels: {k: v} }`; `archon workflow attention --json --all [--label k=v] [--count-by label:<key>]`, `archon workflow attention --watch --json --all [--after <cursor>]`, `archon workflow attention label <run-id> --occurrence <id> --set k=v`, `archon workflow respond|answer <run-id> --occurrence <id> --json`; HTTP `GET /api/runs/attention`, `POST /api/runs/<run-id>/attention/labels`, `POST /api/workflows/runs/<run-id>/answer``

```yaml
name: ci-other-handler       # scheduled listener that drains one class of items
nodes:
  - id: queue
    bash: archon workflow attention --json --all --label ci=other
  - id: decide
    depends_on: [queue]
    prompt: "For each item in $queue.output decide retry or stop."
    output_format: { type: object, properties: { answers: { type: array } }, required: [answers] }
  - id: answer
    depends_on: [decide]
    bash: |
      printf '%s' "$decide.output.answers" | jq -c '.[]' | while read -r it; do
        archon workflow respond "$(jq -r .runId <<<"$it")" "$(jq -r .option <<<"$it")" \
          --occurrence "$(jq -r .occurrence <<<"$it")" --json; done
```
- Ce qui manque ou diffère : This is a durable, streamable, labelled queue drained by scheduled handler workflows or a `--watch` consumer (exactly the listener shape), but its items are paused runs' questions, not new tasks; labels are your columns, Archon reads no meaning into them. `--watch` streaming has no HTTP form yet. `--json` answers record without continuing; a continuation host must run.
- Citations : `packages/docs-web/src/content/docs/guides/attention-queue.md:12-18`, `packages/docs-web/src/content/docs/guides/attention-queue.md:20-43`, `packages/docs-web/src/content/docs/guides/attention-queue.md:109-131`, `packages/docs-web/src/content/docs/guides/attention-queue.md:133-149`, `packages/docs-web/src/content/docs/guides/attention-queue.md:205-273`, `packages/docs-web/src/content/docs/guides/attention-queue.md:275-303`, `packages/docs-web/src/content/docs/reference/cli.md:937-1009`, `packages/docs-web/src/content/docs/reference/api.md:447-458`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:851-881`


### G-trigger-board-listener.10 Chat adapters as the phone entry: Telegram, Slack, Discord, GitHub issue/PR comments (`/workflow run` and @mentions)  —  couverture : **partiel**

- YAML / CLI : `Env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_ALLOWED_USER_IDS`, `DISCORD_BOT_TOKEN`, `GITHUB_TOKEN` + `WEBHOOK_SECRET` (GitHub `/webhooks/github`, `GITHUB_BOT_MENTION`); chat commands `/workflow run <name> [args]`, `/workflow status`, `/workflow get <id>`, `/workflow approve|reject <id>`, `/setproject <name>`; adapters start automatically with `archon serve` when their env vars are set`

```yaml
# ~/.archon/.env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_ALLOWED_USER_IDS=123456789
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
# then from the phone:
#   /setproject widgets
#   /workflow run archon-ship #142
#   /workflow approve <run-id>
```
- Ce qui manque ou diffère : A chat message starts a conversational run immediately: it is not a trigger binding, so there is no durable receipt, dedup, `resource`/`overlap` admission or board entry, and the run is tied to the thread (Slack buttons, lifecycle reactions). Telegram/Slack/Discord cannot be used as webhook *sources* for bindings. Only the run's starter or an admin may act on it, and chat identities never become the local operator.
- Citations : `packages/docs-web/src/content/docs/reference/configuration.md:553-587`, `packages/docs-web/src/content/docs/reference/commands.md:16-44`, `packages/docs-web/src/content/docs/reference/commands.md:85-119`, `packages/docs-web/src/content/docs/reference/commands.md:123-137`, `packages/docs-web/src/content/docs/adapters/index.md:12-22`, `packages/docs-web/src/content/docs/adapters/index.md:45-50`, `packages/docs-web/src/content/docs/adapters/telegram.md:12-43`, `packages/docs-web/src/content/docs/adapters/slack.md:159-215`, `packages/docs-web/src/content/docs/adapters/github.md:101-121`, `packages/docs-web/src/content/docs/getting-started/overview.md:584-593`, `packages/docs-web/src/content/docs/reference/security.md:195-208`


### G-trigger-board-listener.11 Programmatic start + wait for a custom listener: REST `POST /api/workflows/{name}/run` and `archon workflow run --detach --json` / `archon workflow wait`  —  couverture : **partiel**

- YAML / CLI : ``POST /api/workflows/{name}/run` body `{message, conversationId, inputs: {..}, tiers?, aliases?, config?}`; `archon workflow run <name> --cwd <path> --input k=v --detach --json` → `{runId, transcriptPath, logPath}`; `archon workflow wait <run-id> --json [--timeout <s>]`; `archon workflow runs --json --all [--status ...]`; `GET /api/dashboard/runs``

```yaml
# listener script: start one run per NEW item, then wait on it
ack=$(archon workflow run process-task --cwd /abs/project \
        --input task_id=42 --detach --json)
run=$(printf '%s' "$ack" | jq -r .runId)
archon workflow wait "$run" --json          # exit 0 → terminal / attention / owner_lost
# or over HTTP:
curl -X POST http://localhost:3090/api/workflows/process-task/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"task 42","conversationId":"conv-board","inputs":{"task_id":"42"}}'
```
- Ce qui manque ou diffère : These paths bypass the trigger boundary: no signature, no delivery dedup, no `resource` queue (a second run on the same working path is rejected by the path lock, not queued, unless `mutates_checkout: false`/worktrees). The API needs a `conversationId` and an identity (`X-Archon-User` behind a trusted proxy or a Better Auth session). Fresh CLI runs have no chat history; inspect with `workflow get/logs`.
- Citations : `packages/docs-web/src/content/docs/reference/api.md:297-316`, `packages/docs-web/src/content/docs/reference/api.md:326-359`, `packages/docs-web/src/content/docs/reference/api.md:479-492`, `packages/docs-web/src/content/docs/reference/cli.md:294-327`, `packages/docs-web/src/content/docs/reference/cli.md:342`, `packages/docs-web/src/content/docs/reference/cli.md:350`, `packages/docs-web/src/content/docs/reference/cli.md:823-852`, `packages/docs-web/src/content/docs/reference/cli.md:582-595`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1585-1589`


### G-trigger-board-listener.12 Proactive workflow pattern (cheap classifier → `when:` → work → `wait: attention form: approval` → `cancel:`/act) with chat/web-push notices  —  couverture : **partiel**

- YAML / CLI : `Nodes: `prompt:` on tier `small` with `output_format`, `when: "$classify.output.route == 'investigate'"`, `wait: { attention: ..., form: approval }`, `cancel:` with `when: "$review.output.decision == 'reject'"`; answer via `archon workflow approve|reject <run-id>`; notices via `~/.archon/config.yaml` `attentionNotices: [{platform: slack, destination: C…}]` and console Settings → Alerts (Web Push)`

```yaml
nodes:
  - id: classify
    model: small
    prompt: "Does issue $INPUTS.issue_number need work? Return route and reason."
    output_format: { type: object, properties: { route: { type: string, enum: [investigate, skip] }, reason: { type: string } }, required: [route, reason] }
  - id: work
    depends_on: [classify]
    when: "$classify.output.route == 'investigate'"
    prompt: "Do the work; write to $ARTIFACTS_DIR; change nothing outside."
  - id: review
    depends_on: [work]
    wait: { attention: "Approve the result? $classify.output.reason", form: approval }
  - id: drop
    depends_on: [review]
    when: "$review.output.decision == 'reject'"
    cancel: "Rejected"
  - id: act
    depends_on: [review]
    when: "$review.output.decision == 'approve'"
    bash: ./scripts/publish.sh
```
- Ce qui manque ou diffère : The reference example `.archon/workflows/examples/proactive-issue-investigation.yaml` is not in this copy and is not part of the bundled pack. Chat/push notices fire only for approval gates, `wait: attention` pauses and the completion of a run that was notified; a run that never pauses sends no "DONE" notice (put a final approval wait, or a `bash:` node that posts to the chat, at the end). Routes live only in global config and need a chat plugin declaring `attentionNotices`.
- Citations : `packages/docs-web/src/content/docs/guides/proactive-workflows.md:12-40`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:74-78`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:80-94`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3548-3593`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:23-27`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:29-39`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:41-73`, `packages/docs-web/src/content/docs/reference/configuration.md:113-118`


### G-trigger-board-listener.13 External-event wake of a parked run: `wait: event` + `archon workflow signal` / `POST /api/workflows/runs/{runId}/signal`  —  couverture : **partiel**

- YAML / CLI : ``wait: { event: <name>, deadline_ms: <n> }`; `archon workflow signal <full-run-id> --event <name> --occurrence '<metadata.wait.pauseId>' --data '<json>' --json`; HTTP `POST /api/workflows/runs/<run-id>/signal` `{event, occurrence, payload}`; also `wait: { duration_ms }` / `wait: { until }``

```yaml
nodes:
  - id: checks
    wait:
      event: checks.complete
      deadline_ms: 86400000
  - id: next
    depends_on: [checks]
    when: "$checks.output.status == 'satisfied'"
    bash: echo "$checks.output.payload"
# archon workflow signal <run-id> --event checks.complete --occurrence '<pauseId>' --data '{"conclusion":"success"}' --json
```
- Ce qui manque ou diffère : Per-run, not per-board: an event wait needs a `deadline_ms` (it cannot stay open forever) and the signaller must know the run id and `metadata.wait.pauseId`. Durable waits are refused in container-isolated runs; continuation needs `archon serve`, `archon workflow wake`, or the owning CLI process.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:813-849`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:887-900`, `packages/docs-web/src/content/docs/reference/cli.md:1062-1073`, `packages/docs-web/src/content/docs/reference/api.md:314-317`


### G-trigger-board-listener.14 Batch dispatch inside the listener run: `fan_out:` over a list of board items into child `workflow:` runs  —  couverture : **partiel**

- YAML / CLI : ``workflow: <name>` + `fan_out: { items: "$node.output", as: <input-name>, max_parallel: <n>, join: all_done|all_success }`, optional `isolation: worktree`; `with:` map for declared inputs`

```yaml
nodes:
  - id: pick-new
    bash: archon state get board/queue --json | jq -c '.value.items | map(select(.status=="NEW"))'
  - id: work-each
    workflow: process-task
    depends_on: [pick-new]
    isolation: worktree
    fan_out:
      items: "$pick-new.output"
      as: task
      max_parallel: 3
  - id: report
    depends_on: [work-each]
    prompt: "Summarize: $work-each.output"
```
- Ce qui manque ou diffère : Fan-out is a batch inside one run, not a continuous listener: `items` is unbounded (bound it in the producer), paused children hold their slot, and there is no claim/lease per item beyond what you implement in state docs; a child pause pauses the parent tree.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2160`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2188-2201`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2303-2330`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2461-2504`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2506-2548`


## H — L'humain vérifie à la fin seulement

Archon implements "human only at the end" with one authored primitive, `wait: attention` + `form: approval` (plus `cancel:`/`when:` routing on `$<id>.output.decision`), surfaced through the attention queue, the console "Needs your input" banner, web push, chat `attentionNotices` routes, and the CLI/HTTP/chat answer verbs (`archon workflow approve|reject|respond|answer`, `/workflow approve`, `POST .../answer`). The bundled sdlc pack applies the idea by convention: `archon-deliver`/`archon-ship` "never pause for approval; your gate is PR review and merge", end with a PR marked ready for review, and never merge. Keeping the human out of the middle is done by composition rather than an engine switch: deterministic `bash:`/`script:` checks with `output_format`, `outcome_field`, `mutates_checkout`, tool restrictions and hooks replace mid-run oversight, `when:`-guarded waits ask only when the agent is blocked, and labelled attention items can be answered by handler workflows so only the residue reaches a person; there is no routing to a named approver, no deadline/escalation on an unanswered wait, no engine assertion that a workflow has a single terminal gate, and no in-engine merge step.


### H-human-at-end.1 Attention wait with the approval form (`wait: attention`, `form: approval`)  —  couverture : **natif**

- YAML / CLI : `nodes[].wait: { attention: <question>, form: approval | select | multi_select | message, options?, labels? }`

```yaml
nodes:
  - id: deliver
    prompt: "Implement, test and open the PR for $USER_MESSAGE"
  - id: review
    depends_on: [deliver]
    wait:
      form: approval
      attention: |
        Final check before anything is merged:
        $deliver.output
```
- Ce qui manque ou diffère : The pause is durable and returns the worker slot, but Archon 'does not route the question or care who answers' (no assignee, no named approver) and an attention wait has no deadline (no escalation/timeout). Not supported in container-isolated runs (`wait:` is refused before the run starts). The legacy `approval:` gate is deprecated and its reject cancels the run, unlike the attention form.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:12-19`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:23-65`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:67-94`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:813-815`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:851-883`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:904`, `packages/docs-web/src/content/docs/book/dag-workflows.md:305-324`, `packages/docs-web/src/content/docs/getting-started/concepts.md:44`, `packages/docs-web/src/content/docs/book/quick-reference.md:137-138`


### H-human-at-end.2 Route the answer: `cancel:` on reject, `when:` on approve  —  couverture : **natif**

- YAML / CLI : `nodes[].when: "$review.output.decision == 'approve'" ; nodes[].cancel: <reason> with when: "... == 'reject'"`

```yaml
  - id: stop
    depends_on: [review]
    when: "$review.output.decision == 'reject'"
    cancel: Rejected by the final reviewer.
  - id: publish
    depends_on: [review]
    when: "$review.output.decision == 'approve'"
    bash: gh pr ready "$PR_NUMBER"   # bash, so nothing rewords approved work
```
- Ce qui manque ou diffère : Nothing for the gate itself. `reject` is an answer, never a cancellation, so the `cancel:` node must be authored explicitly; Archon does not translate a legacy reject-cancels gate for you.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:42-53`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:63-65`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:128-141`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3548-3593`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3601-3621`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:34-36`, `packages/docs-web/src/content/docs/reference/variables.md:125-129`


### H-human-at-end.3 Proactive workflow pattern: 'whoever answers reviews finished work instead of starting each run'  —  couverture : **natif**

- YAML / CLI : `trigger binding -> small-tier `prompt:` classifier with `output_format` -> `when:` -> work -> `wait: { form: approval }` -> `cancel:` on reject -> `bash:` act on approve`

```yaml
nodes:
  - id: classify
    model: small
    prompt: "Does this issue need investigation? $INPUTS.issue_number"
    output_format: { type: object, properties: { route: { type: string, enum: [investigate, skip] } }, required: [route] }
  - id: investigate
    depends_on: [classify]
    when: "$classify.output.route == 'investigate'"
    prompt: "Investigate and draft a comment. Do not write to GitHub."
  - id: review
    depends_on: [investigate]
    wait: { form: approval, attention: "Post this? $investigate.output" }
  - id: drop
    depends_on: [review]
    when: "$review.output.decision == 'reject'"
    cancel: Draft rejected
```
- Ce qui manque ou diffère : The reference workflow `.archon/workflows/examples/proactive-issue-investigation.yaml` is not part of the bundled pack and the `.archon/` directory is absent from this copy; copy it from the upstream repository. The pattern is a convention (one terminal wait), not something the loader enforces.
- Citations : `packages/docs-web/src/content/docs/guides/proactive-workflows.md:12-24`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:28-40`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:74-78`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:80-94`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:118-122`


### H-human-at-end.4 SDLC pack delivery tail: no pause, PR marked ready for review, never merges (`archon-deliver`, `archon-ship`, `archon-upkeep`, `archon-pr`)  —  couverture : **natif**

- YAML / CLI : `archon workflow run archon-ship --branch <b> "#N" ; archon workflow run archon-deliver --branch <b> "<plan>" ; archon workflow run archon-pr --no-worktree --input draft=false`

```yaml
# Human-free until the PR is ready; the human's gate is PR review + merge
archon workflow run archon-ship --branch fix/login-crash "#142"
# Continue an open PR instead of opening one
archon workflow run archon-deliver --branch feat/x --input pull_request=87 "Deliver the plan"
# Open a non-draft PR for committed work
archon workflow run archon-pr --no-worktree --input draft=false
```
- Ce qui manque ou diffère : This is pack behaviour, not an engine flag: the 'ready for review' state lives on GitHub (`pr.ready`/`pr.draft` via `gh` or the forge plugin), and merging is entirely outside Archon (the pack never calls `pr.merge`). `archon-plan` still 'stops for a person' mid-run on semantic changes unless a ruling in `.archon/sdlc/policy/rulings.md` already answers it. The pack YAMLs are absent from this copy.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:50-60`, `packages/docs-web/src/content/docs/book/essential-workflows.md:162-172`, `packages/docs-web/src/content/docs/book/essential-workflows.md:176-186`, `packages/docs-web/src/content/docs/book/essential-workflows.md:231-241`, `packages/docs-web/src/content/docs/book/first-five-minutes.md:77-83`, `packages/docs-web/src/content/docs/book/how-it-works.md:17-56`, `packages/docs-web/src/content/docs/book/how-it-works.md:62-72`, `packages/docs-web/src/content/docs/reference/forge.md:141-149`


### H-human-at-end.5 Attention queue (list, stream, read, label, answer) and handler workflows that answer classes of questions  —  couverture : **partiel**

- YAML / CLI : `archon workflow attention --json [--all|--project] [--label k=v] [--sort age|label:<key>] [--count-by ...] ; --watch --json [--after <cursor>] ; archon workflow attention label <run-id> --occurrence <id> --set k=v ; nodes[].wait.labels: {k: v}`

```yaml
  - id: ask
    depends_on: [classify]
    wait:
      attention: "$classify.output.summary"
      form: select
      options: [{ id: retry }, { id: stop }]
      labels:
        ci: "$classify.output.cause"   # a handler workflow selects ci=other
        area: delivery
# handler: archon workflow attention --json --all --label ci=other
#          archon workflow respond <runId> retry --occurrence <occ> --json
```
- Ce qui manque ou diffère : Covers 'everything that needs a person, in one place' and lets agents answer labelled classes so only the residue reaches a human, but Archon 'routes nothing', 'never decides whether a person or an agent answers', and gives labels no meaning; the classify-then-route pipeline is yours to build and schedule. Gates (`awaiting_response`) carry no labels or `pausedAt`.
- Citations : `packages/docs-web/src/content/docs/guides/attention-queue.md:12-43`, `packages/docs-web/src/content/docs/guides/attention-queue.md:45-102`, `packages/docs-web/src/content/docs/guides/attention-queue.md:107-131`, `packages/docs-web/src/content/docs/guides/attention-queue.md:133-149`, `packages/docs-web/src/content/docs/guides/attention-queue.md:205-273`, `packages/docs-web/src/content/docs/guides/attention-queue.md:275-303`, `packages/docs-web/src/content/docs/reference/cli.md:937-1009`, `packages/docs-web/src/content/docs/reference/api.md:447-458`


### H-human-at-end.6 Find the runs waiting on you: `workflow wait`, `workflow status --all`, `workflow runs --json --verbose` `attention` field, `workflow get`  —  couverture : **natif**

- YAML / CLI : `archon workflow wait <run-id> [--json] [--timeout <s>] ; archon workflow status --all ; archon workflow runs --json --verbose ; archon workflow get <run-id>`

```yaml
# launch detached, then block until the run finishes or needs a person
run=$(archon workflow run my-flow --detach --json | jq -r .runId)
archon workflow wait "$run" --json   # attention.kind: terminal | attention | awaiting_response | ...
archon workflow status --all         # every active run across projects
archon workflow get "$run"           # read the question and the occurrence
```
- Ce qui manque ou diffère : `workflow wait` has no default timeout and watches one run; install-wide watching is `workflow attention --watch`. Exit codes describe the command, not the run.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:823-842`, `packages/docs-web/src/content/docs/reference/cli.md:844-912`, `packages/docs-web/src/content/docs/reference/cli.md:560-580`, `packages/docs-web/src/content/docs/reference/cli.md:610-616`, `packages/docs-web/src/content/docs/reference/cli.md:350`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:82-87`


### H-human-at-end.7 Answer surfaces: CLI verbs, chat slash commands, HTTP, web console  —  couverture : **natif**

- YAML / CLI : `archon workflow approve|reject|respond|answer <run-id> [--occurrence <id>] [--json|--detach] ; /workflow approve|reject <id> [text] (chat, /archon-workflow in Slack) ; POST /api/workflows/runs/<id>/answer {occurrence, choose?, text?} ; POST .../approve|reject {expectedGate}`

```yaml
archon workflow approve <run-id> "Looks good"
archon workflow reject <run-id> "Needs tests"
archon workflow respond <run-id> use-dev --occurrence <occ> --json
archon workflow answer <run-id> --occurrence <occ> --choose reject --text "Not yet"
curl -X POST http://localhost:3090/api/workflows/runs/<run-id>/answer \
  -H 'Content-Type: application/json' \
  -d '{"occurrence":"<occ>","choose":"approve","text":"ship it"}'
```
- Ce qui manque ou diffère : Only the run's starter or an admin (or the local CLI operator) may answer; 'Named gate approvers are not supported'. An answer names its occurrence, so stale answers are refused (409). In chat, a free-text message is answered only when it 'clearly is' an answer.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:96-126`, `packages/docs-web/src/content/docs/reference/cli.md:1187-1242`, `packages/docs-web/src/content/docs/reference/cli.md:1244-1305`, `packages/docs-web/src/content/docs/reference/commands.md:41-42`, `packages/docs-web/src/content/docs/reference/api.md:310-313`, `packages/docs-web/src/content/docs/reference/api.md:416-443`, `packages/docs-web/src/content/docs/reference/security.md:195-208`


### H-human-at-end.8 Notify the human when a run pauses: console 'Needs your input' banner, web push (Settings → Alerts), chat `attentionNotices` routes, `pause_notice_undelivered` event  —  couverture : **natif**

- YAML / CLI : `~/.archon/config.yaml attentionNotices: [{platform, destination}] ; console Settings → Alerts ; GET /api/web-push/key, POST /api/web-push/subscriptions`

```yaml
# ~/.archon/config.yaml (global config only; repo config cannot carry routes)
attentionNotices:
  - platform: slack
    destination: C0123456789   # passed to the plugin unchanged
```
- Ce qui manque ou diffère : Push is per opted-in browser and per install, chat routes are per channel (one message per pause occurrence) and need a plugin declaring the `attentionNotices` capability; there is no per-person routing, no email/SMS channel, no reminder or escalation for an unanswered pause.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:23-27`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:29-39`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:41-73`, `packages/docs-web/src/content/docs/reference/configuration.md:113-118`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:55-61`, `packages/docs-web/src/content/docs/reference/api.md:636-644`


### H-human-at-end.9 Continuation hosts so an answer continues the run without a person at a terminal: `archon serve`, `archon workflow wake --watch`, inline CLI answer; `--json` records only  —  couverture : **natif**

- YAML / CLI : `archon serve ; archon workflow wake [--watch] --json ; archon workflow wake schedule install --interval 5 ; archon workflow resume <run-id>`

```yaml
# long-lived continuation host beside triggers (Linux: systemd user service)
archon workflow wake --watch --json
# macOS LaunchAgent
archon workflow wake schedule install --interval 5 --json
# an answer given with --json is only recorded; serve/wake continues it
```
- Ce qui manque ou diffère : Container runs are the exception: a decision from chat/web is recorded but the container only continues with `archon workflow resume <run-id>` from the CLI in the same project. A paused run gives back its resource slot and may wait for capacity (`waiting_for_capacity`) after it is answered.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1026-1058`, `packages/docs-web/src/content/docs/reference/cli.md:1239-1242`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:124-126`, `packages/docs-web/src/content/docs/guides/attention-queue.md:266-273`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:197`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:881`, `packages/docs-web/src/content/docs/reference/api.md:441`


### H-human-at-end.10 Revise until approved: `loop_group` whose body ends in the wait, `until_bash` on the decision, `$LOOP_PREV.<wait>.output.text`  —  couverture : **natif**

- YAML / CLI : `nodes[].loop_group: { max_iterations, until_bash: 'decision=$review.output.decision; [ "$decision" = approve ]', nodes: [..., {wait}] }`

```yaml
- id: refine
  loop_group:
    max_iterations: 3
    until_bash: 'decision=$review.output.decision; [ "$decision" = approve ]'
    nodes:
      - id: revise
        prompt: |
          Improve the deliverable. Reviewer feedback, if any: $LOOP_PREV.review.output.text
      - id: review
        depends_on: [revise]
        wait:
          form: approval
          attention: "Review the revision: $revise.output"
```
- Ce qui manque ou diffère : The wait must be the body's sole terminal sink; each answer permits one more iteration past `max_iterations`, so the loop is bounded by the person, not the engine. Waits below more than one nested loop_group are not supported.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:143-174`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:605-652`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3623-3653`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:902`, `packages/docs-web/src/content/docs/reference/variables.md:32-35`


### H-human-at-end.11 Ask only when blocked: `when:` on the `wait:` node driven by a typed `blocked` field (pause only when needed)  —  couverture : **partiel**

- YAML / CLI : `nodes[].wait with when: "$draft.output.blocked == 'true'" ; producer output_format with a boolean `blocked``

```yaml
- id: plan
  loop_group:
    until_bash: 'blocked=$draft.output.blocked; [ "$blocked" = false ]'
    max_iterations: 5
    nodes:
      - id: draft
        prompt: "Draft the plan. Set blocked true only if you need a decision."
        output_format: { type: object, properties: { plan: {type: string}, blocked: {type: boolean} }, required: [plan, blocked] }
      - id: plan-question
        depends_on: [draft]
        when: "$draft.output.blocked == 'true'"
        wait: { attention: "The draft needs a decision: $draft.output.plan" }
```
- Ce qui manque ou diffère : This is an authoring pattern, not an engine policy: nothing stops a workflow from pausing mid-run, and a skipped wait has no output (an `until_bash` that reads it fails). The sdlc pack's equivalent is `archon-plan` checking `.archon/sdlc/policy/rulings.md` before stopping for a person.
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:654-687`, `packages/docs-web/src/content/docs/book/essential-workflows.md:144`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:518-520`


### H-human-at-end.12 Engine-initiated end-of-run gate for folder projects: container write-back (`container.write_back: approve | auto`)  —  couverture : **natif**

- YAML / CLI : `workflow-level container: { write_back: approve } ; archon workflow run <wf> --folder --container ; archon workflow approve|reject <run-id> ; archon workflow resume <run-id>`

```yaml
# .archon/workflows/reorganize.yaml
name: reorganize
container:
  enabled: true
  write_back: approve   # pause on the overlay diff; 'auto' applies without pausing
nodes:
  - id: work
    prompt: "Reorganize the invoices folder"
# then: archon workflow approve <run-id>  -> diff applied to the live root
```
- Ce qui manque ou diffère : Folder projects only (repo projects use worktrees and PRs instead). Container runs refuse `wait:` nodes, are not continued by `serve`/`wake`, and a decision from chat/web must be followed by `archon workflow resume` from the CLI. Claude provider only today.
- Citations : `packages/docs-web/src/content/docs/guides/container-isolation.md:12`, `packages/docs-web/src/content/docs/guides/container-isolation.md:18-31`, `packages/docs-web/src/content/docs/guides/container-isolation.md:56-81`, `packages/docs-web/src/content/docs/reference/configuration.md:470-478`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:176-182`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:196-199`, `packages/docs-web/src/content/docs/reference/cli.md:341`


### H-human-at-end.13 Deterministic checks that replace mid-run human oversight: `bash:`/`script:` nodes with `output_format`, `outcome_field`, `evidence_policy`, `mutates_checkout: false`, `allowed_tools`/`denied_tools`, static `hooks:`  —  couverture : **partiel**

- YAML / CLI : `nodes[].bash / nodes[].script + output_format ; workflow outcome_field: <bool field> ; evidence_policy: { required: true } ; mutates_checkout: false ; allowed_tools / denied_tools ; hooks.PreToolUse[].response.hookSpecificOutput.permissionDecision: deny`

```yaml
name: verified-block
returns: verdict
outcome_field: ok
nodes:
  - id: review
    command: code-review
    allowed_tools: [Read, Grep, Glob]
    mutates_checkout: false
  - id: verdict
    depends_on: [review]
    bash: ./scripts/check.sh "$ARTIFACTS_DIR"   # exit != 0 fails the node
    output_format:
      type: object
      properties: { ok: { type: boolean } }
      required: [ok]
```
- Ce qui manque ou diffère : These are the primitives that let code, not a person, verify the middle of the run, but 'there is no special verification node or verification status'; `evidence_policy` is only a file-presence convention and `outcome_field` does not control lifecycle status. Tool restrictions are not enforced on Codex.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1969-1981`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2925`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:750-772`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:235`, `packages/docs-web/src/content/docs/guides/hooks.md:25-39`, `packages/docs-web/src/content/docs/guides/hooks.md:59-77`, `packages/docs-web/src/content/docs/guides/hooks.md:387-399`


### H-human-at-end.14 Test the gate's routes without a person: `--dry-run` with wait stubs and `archon workflow test` fixtures  —  couverture : **natif**

- YAML / CLI : `archon workflow run <wf> --dry-run --stubs stubs.yaml [--pause-at-gates] ; archon workflow test <wf> ; stub `review: { decision: approve, text: "" }``

```yaml
# stubs.yaml
classify: { route: investigate, reason: "regression with a stack trace" }
investigate: { comment: "The cause is the null check in parser.ts" }
review: { decision: approve, text: "" }   # omit to see the simulation pause here
# archon workflow run my-flow --dry-run --stubs stubs.yaml --input issue_number=42
# archon workflow test my-flow
```
- Ce qui manque ou diffère : Dry runs auto-approve only legacy `approval:` gates; an attention wait pauses the simulation unless stubbed. Fixture layout for `workflow test` is described only by example here.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:255-260`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:96-116`, `packages/docs-web/src/content/docs/reference/cli.md:351-356`


### H-human-at-end.15 Human-free start and non-blocking waits: trigger bindings (`runAsUserId`, `resource`, `capacity`, `overlap`) and slot release while paused  —  couverture : **natif**

- YAML / CLI : `binding JSON: { bindingId, hostId, runAsUserId, resource, capacity, overlap: queue|skip, launch: { cwd, workflowName, inputs, isolation }, selector, inputMapping } ; archon trigger fire --config <file> ; archon trigger drain --host <id>`

```yaml
{
  "bindingId": "widgets-issue-investigation",
  "hostId": "build-host-1",
  "runAsUserId": "<archon trigger whoami>",
  "resource": "github:acme/widgets:issue-investigation",
  "capacity": 3,
  "overlap": "queue",
  "launch": { "cwd": "/srv/archon/widgets", "workflowName": "proactive-issue-investigation", "inputs": {}, "isolation": { "kind": "default" } },
  "selector": { "kind": "issue.lifecycle", "actions": ["opened"], "repository": { "host": "github.com", "path": "acme/widgets" } },
  "inputMapping": { "issue_number": { "source": "field", "field": "subject.number" } }
}
```
- Ce qui manque ou diffère : Only the start is human-free by construction; a run paused at the final gate releases its slot so unreviewed work does not block later runs, but a continuation host (`serve` or `wake --watch`) is required for it to continue after the answer. Triggered runs have no chat conversation, so the question reaches a person only via console, push or `attentionNotices`.
- Citations : `packages/docs-web/src/content/docs/guides/workflow-triggers.md:12-21`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:184-199`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:48-76`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:477-485`


### H-human-at-end.16 Pauses in composed runs: answer the child by its run id; parent auto-resumes; one wait after a `fan_out:` reads the whole aggregate  —  couverture : **partiel**

- YAML / CLI : `archon workflow approve <childRunId> ; /workflow approve <childRunId> ; wait: node after fan_out reading $<fan>.output`

```yaml
  - id: reviews
    fan_out:
      items: "$plan.output.units"
      workflow: review-one-unit     # children never wait: they return typed verdicts
      max_parallel: 4
  - id: final-check
    depends_on: [reviews]
    wait:
      form: approval
      attention: "All units reviewed. Aggregate: $reviews.output"
```
- Ce qui manque ou diffère : If children themselves pause, each becomes its own queue item and the person is asked N times; Archon does not aggregate children's questions into one gate. Keeping the single human gate after the join is an authoring convention (children return `output_format` verdicts instead of waiting).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2220-2224`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2662-2684`, `packages/docs-web/src/content/docs/reference/cli.md:1230`, `packages/docs-web/src/content/docs/reference/api.md:443`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:183-185`, `packages/docs-web/src/content/docs/book/quick-reference.md:176`


### H-human-at-end.17 SDLC standing autonomy front: `archon-intake` and `archon-build-queue` (trigger-started, pauses 'as one attention item' only for decisions that need a person)  —  couverture : **partiel**

- YAML / CLI : `archon workflow run archon-build-queue --input mode=eval ; archon state get work/<number> ; .archon/sdlc/policy/maintainers.json ; .archon/sdlc/policy/rulings.md`

```yaml
# evaluate what the queue would decide, writing nothing
archon workflow run archon-build-queue --input mode=eval
# inspect the per-issue work item the pack keeps
archon state get work/142
# maintainers who may trigger agents on outside issues
cat .archon/sdlc/policy/maintainers.json
```
- Ce qui manque ou diffère : The pack installs no trigger bindings (the SDLC pack README shows them) and the pack YAMLs and README are absent from this copy, so the exact node shapes could not be cited. Decisions that need a person still surface mid-pipeline (as attention items), not only at the end.
- Citations : `packages/docs-web/src/content/docs/book/essential-workflows.md:90-106`, `packages/docs-web/src/content/docs/book/essential-workflows.md:110-116`, `packages/docs-web/src/content/docs/book/essential-workflows.md:144`, `packages/docs-web/src/content/docs/book/essential-workflows.md:247-261`


### H-human-at-end.18 After the human merges: `archon complete <branch>` / `archon isolation cleanup --merged`  —  couverture : **partiel**

- YAML / CLI : `archon complete <branch> [--force] ; archon isolation cleanup --merged [--include-closed]`

```yaml
# the person merges the PR on GitHub (Archon never merges), then:
git fetch --prune origin
archon complete feature-auth
# or sweep every worktree whose branch merged
archon isolation cleanup --merged
```
- Ce qui manque ou diffère : The merge itself, the human's final act, happens outside Archon; `complete` refuses while a run can still claim the worktree and never releases a failed run's lock by merge state.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1530-1558`, `packages/docs-web/src/content/docs/book/isolation.md:95-114`, `packages/docs-web/src/content/docs/book/isolation.md:130`, `packages/docs-web/src/content/docs/book/essential-workflows.md:60`


### H-human-at-end.19 Legacy `approval:` gate (deprecated, still runs)  —  couverture : **natif**

- YAML / CLI : `nodes[].approval: { message, decisions?, capture_response?, on_reject: { prompt, max_attempts } } ; $REJECTION_REASON ; archon workflow run --dry-run --pause-at-gates`

```yaml
# deprecated; loads with a warning naming the replacement
- id: review
  depends_on: [plan]
  approval:
    message: "Review the plan."
    capture_response: true
# replacement: wait: { attention: "Review the plan.", form: approval } + cancel on reject
```
- Ce qui manque ou diffère : Deprecated: reject cancels the run, its items carry no labels or `pausedAt`, and container runs are the only place it is still the sole authored pause. Prefer `wait: attention`.
- Citations : `packages/docs-web/src/content/docs/guides/approval-nodes.md:187-253`, `packages/docs-web/src/content/docs/guides/approval-nodes.md:262-286`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3595-3599`, `packages/docs-web/src/content/docs/book/quick-reference.md:178-185`, `packages/docs-web/src/content/docs/reference/variables.md:33`


## I — État durable et artefacts entre blocs

Archon covers intra-run information flow very thoroughly: node outputs are typed values (`$node.output[.field]` with `output_format` contracts), documents travel through the per-run `$ARTIFACTS_DIR` with `output_type` sidecars and a `$TYPED_ARTIFACTS_FILE` listing, `with:` bindings and `inputs:`/`returns:`/`outcome_field:` give blocks an explicit signature, and `include:`/`workflow:`/`fan_out` thread results between composed blocks. Across runs the picture is weaker and more manual: `$STATE_DIR` (unlocked files), `archon state` (audited, 64 KiB JSON documents), `persist_session` (only for conversation-launched runs on fork-capable providers) and `--adopt`/`$ADOPTED_RUN_DIR` exist, but artifact pointers are own-run only, there is no cross-run artifact catalog, no block registry, no task board, and container runs lose both state channels. The bundled sdlc pack YAMLs are absent from this copy.


### I-state-artifacts.1 Node output references with output_format result contracts  —  couverture : **natif**

- YAML / CLI : ``$nodeId.output`, `$nodeId.output.<field>` (nested `a.b`), node `output_format:` (JSON Schema, valid on prompt/command/bash/script/loop), `when:` conditions`

```yaml
nodes:
  - id: classify
    command: classify-issue
    output_format:
      type: object
      properties:
        type: { type: string, enum: [BUG, FEATURE] }
      required: [type]
  - id: fix
    prompt: "Issue type: $classify.output.type\nFull: $classify.output"
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"
```
- Ce qui manque ou diffère : In-run only (the value lives on the run's event record); no array indexing, wildcards or expressions in paths; bash/script outputs over 32 KiB are previewed and spilled to `$ARTIFACTS_DIR/.archon/node-output-spills/`; a failed producer fails every consumer, so there is no partial read.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:245`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:633-676`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:691`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:710-746`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2825`, `packages/docs-web/src/content/docs/reference/variables.md:97-103`, `packages/docs-web/src/content/docs/reference/variables.md:139`, `packages/docs-web/src/content/docs/reference/node-execution.md:322-336`, `packages/docs-web/src/content/docs/guides/script-nodes.md:252-311`


### I-state-artifacts.2 Per-run artifacts directory ($ARTIFACTS_DIR) — the artifact chain  —  couverture : **natif**

- YAML / CLI : ``$ARTIFACTS_DIR` (env `ARTIFACTS_DIR`) = `~/.archon/workspaces/<project>/artifacts/runs/<run-id>/`; `GET /api/runs/{runId}/artifacts`; bind-mounted read-write in `--container` runs`

```yaml
nodes:
  - id: investigate
    command: investigate-issue      # writes $ARTIFACTS_DIR/issues/issue-123.md
  - id: implement
    prompt: "Read $ARTIFACTS_DIR/issues/issue-123.md and implement the fix."
    depends_on: [investigate]
    context: fresh                  # fresh session: reads the file, not the chat
```
- Ce qui manque ou diffère : Scoped to one run: a later run must be handed the path explicitly (`--input`, `--adopt`, a pointer); the filename contract is a convention each command must know; filesystem retention is operator-run (`archon workflow cleanup` deletes DB rows, not these directories).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1407-1438`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3673-3675`, `packages/docs-web/src/content/docs/reference/variables.md:24`, `packages/docs-web/src/content/docs/reference/archon-directories.md:45-54`, `packages/docs-web/src/content/docs/reference/archon-directories.md:98`, `packages/docs-web/src/content/docs/book/how-it-works.md:64-84`, `packages/docs-web/src/content/docs/book/how-it-works.md:128-132`, `packages/docs-web/src/content/docs/guides/container-isolation.md:106`, `packages/docs-web/src/content/docs/reference/configuration.md:480-491`, `packages/docs-web/src/content/docs/reference/api.md:305`, `packages/docs-web/src/content/docs/reference/api.md:400-406`


### I-state-artifacts.3 Typed artifacts (output_type) and the typed-artifact listing ($TYPED_ARTIFACTS_FILE)  —  couverture : **natif**

- YAML / CLI : `node `output_type: <label>` → `$ARTIFACTS_DIR/nodes/<id>.md` + `<id>.meta.json` (`outputType`, `runId`, `producedAt`, `size`, `loopGroupPath`); `$TYPED_ARTIFACTS_FILE` / env `TYPED_ARTIFACTS_FILE` = `{ runId, artifactsByType, errors }``

```yaml
nodes:
  - id: planner
    command: plan-feature
    output_type: plan          # writes nodes/planner.md + nodes/planner.meta.json
  - id: consumer
    runtime: bun
    depends_on: [planner]
    script: |
      const l = JSON.parse(await Bun.file(process.env.TYPED_ARTIFACTS_FILE!).text());
      for (const a of l.artifactsByType['plan'] ?? [])
        console.log(await Bun.file(`${process.env.ARTIFACTS_DIR}/${a.path}`).text());
```
- Ce qui manque ou diffère : Sidecar write is best-effort (node succeeds even if it fails); the listing is a per-invocation snapshot of this run only (no cross-run lookup except the persist_session scope mirror); labels are an open, case-sensitive set and nothing validates the file's content.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:237`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1440-1492`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3737`, `packages/docs-web/src/content/docs/reference/variables.md:25`, `packages/docs-web/src/content/docs/reference/archon-directories.md:47-49`


### I-state-artifacts.4 Artifact pointers in a result (type: archon_artifact) and the artifact read route  —  couverture : **partiel**

- YAML / CLI : ``output_format` object with `type: { const: archon_artifact }`, `run_id`, `path`; served by `GET /api/artifacts/<run_id>/<path>``

```yaml
nodes:
  - id: plan
    command: plan                   # writes $ARTIFACTS_DIR/plan.md, prints the JSON below
    output_format:
      type: object
      properties:
        ready: { type: boolean }
        plan:
          type: object
          properties:
            type: { const: archon_artifact }
            run_id: { type: string }
            path: { type: string }
          required: [type, run_id, path]
      required: [ready, plan]
# {"ready":true,"plan":{"type":"archon_artifact","run_id":"$WORKFLOW_ID","path":"plan.md"}}
```
- Ce qui manque ou diffère : A pointer may only name the producing run (`run_id` must equal `$WORKFLOW_ID`), so no cross-run pointers; no in-workflow resolver (prompts keep using the `$ARTIFACTS_DIR/<path>` string); read-side real-path resolution not implemented (#3160).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2960-3004`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3006-3061`, `packages/docs-web/src/content/docs/reference/variables.md:251-289`, `packages/docs-web/src/content/docs/reference/api.md:305`, `packages/docs-web/src/content/docs/reference/api.md:400-406`


### I-state-artifacts.5 Workflow signature: inputs / returns / outcome_field with $INPUTS and --input  —  couverture : **natif**

- YAML / CLI : `workflow-level `inputs: { name: { required?, default?, description? } }`, `returns: <node-id>`, `outcome_field: <bool field>`; `$INPUTS.<name>` in prompts/commands, env `INPUTS_<UPPER_SNAKE>` in bash/script; `archon workflow run <wf> --input k=v`; API `inputs` map; trigger `inputMapping` / `archon trigger fire --inputs <file>``

```yaml
name: review-block
inputs:
  diff: { required: true, description: the diff to review }
  style: { default: strict }
returns: synthesize
outcome_field: green
nodes:
  - id: synthesize
    prompt: Review $INPUTS.diff (style $INPUTS.style); report whether it is green.
    output_format:
      type: object
      properties: { review: { type: string }, green: { type: boolean } }
      required: [review, green]
# archon workflow run review-block --input diff="$(git diff)" --input style=terse
```
- Ce qui manque ou diffère : Inputs are small values (CLI/console pass plain strings; sub-run inputs persist on the child's metadata); chat platforms have no inputs channel (#2555); `include:` binds at load time so `$INPUTS` must sit on the right of a `when:` there; `inputs:` carries no type schema beyond required/default; `outcome_field` must be a required boolean on the `returns:` node.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:154-158`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1991`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2012-2043`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2087-2131`, `packages/docs-web/src/content/docs/reference/cli.md:305-307`, `packages/docs-web/src/content/docs/reference/cli.md:342`, `packages/docs-web/src/content/docs/reference/api.md:342-359`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:336`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:444`, `packages/docs-web/src/content/docs/guides/workflow-triggers.md:479-481`, `packages/docs-web/src/content/docs/reference/database.md:277-284`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:38`


### I-state-artifacts.6 Node-local with: bindings on command/script nodes ({from, if_skipped}, $node.execution.checkoutStart)  —  couverture : **natif**

- YAML / CLI : ``with: { name: $node.output.field }` → `$INPUTS.<name>` in a command file, `INPUTS_<UPPER_SNAKE>` env in a script; `{ from: $node.output.x, if_skipped: <value> }`; `"$node.execution.checkoutStart"``

```yaml
nodes:
  - id: implement
    command: implement-issue
    output_format:
      type: object
      properties: { green: { type: boolean } }
      required: [green]
  - id: record-verdict
    script: record-verdict          # reads process.env.INPUTS_GREEN
    runtime: bun
    depends_on: [implement, optional-check]
    trigger_rule: all_done
    with:
      green: $implement.output.green
      prior: { from: $optional-check.output.ok, if_skipped: false }
```
- Ce qui manque ou diffère : Carries values, not documents (docs say keep files on the artifact chain); every bound producer must be in `depends_on`; `$LOOP_PREV` cannot appear in a `from:` directive; a failed producer always fails the binding.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1289-1368`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1370-1405`, `packages/docs-web/src/content/docs/reference/variables.md:185-249`


### I-state-artifacts.7 Composition data flow: include + with, workflow sub-runs (input/with, isolation), fan_out aggregates  —  couverture : **partiel**

- YAML / CLI : ``include: <wf>` + `with:`; `workflow: <wf>` + `input:` (→ child `$ARGUMENTS`) or `with:` (→ child `$INPUTS`) + `isolation: inherit|worktree`; `fan_out: { items, as, max_parallel, join }`; `$<id>.output` (child's `returns:` value; ordered JSON array for fan-out)`

```yaml
nodes:
  - id: plan
    include: plan-block             # $plan.output = plan-block's returns: node
  - id: work
    workflow: unit-block            # separate child run, own artifacts dir
    depends_on: [plan]
    isolation: worktree
    fan_out:
      items: "$plan.output.units"
      as: unit                      # each child reads $INPUTS.unit
      max_parallel: 2
  - id: report
    prompt: "Per-unit results: $work.output\nPlan: $plan.output.plan"
    depends_on: [work]
```
- Ce qui manque ou diffère : Only the child's terminal/`returns:` value threads back; a `workflow:` child has its own artifacts directory and, with `isolation: worktree`, sees neither the parent's uncommitted edits nor its artifacts unless passed via `input:`/`with:`/a path; nothing merges a child worktree back; field access on a fan-out aggregate is an error; `$includeId.output` exposes only the block's terminal/returns node.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:221-222`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1745`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1803-1857`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2138-2217`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2341-2355`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2493-2530`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2727-2800`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2934-2958`


### I-state-artifacts.8 Cross-run file state: $STATE_DIR  —  couverture : **partiel**

- YAML / CLI : ``$STATE_DIR` (env `STATE_DIR`) = `~/.archon/workspaces/<project>/state/`, pre-created, shared by every workflow of the project`

```yaml
nodes:
  - id: load-state
    runtime: bun
    script: |
      import { readFile } from 'fs/promises';
      const path = `${process.env.STATE_DIR}/triage/seen.json`;
      let seen: string[] = [];
      try { seen = JSON.parse(await readFile(path, 'utf-8')); } catch {}
      console.log(JSON.stringify({ seen }));
```
- Ce qui manque ou diffère : No locking (lost updates between concurrent runs); per project not per workflow (namespace it yourself); not mounted into `--container` runs; no retention or audit history; an AI node writing there is a convention the docs tell you not to rely on (use a script node).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1531-1592`, `packages/docs-web/src/content/docs/reference/variables.md:26`, `packages/docs-web/src/content/docs/reference/variables.md:53-80`, `packages/docs-web/src/content/docs/reference/archon-directories.md:53`, `packages/docs-web/src/content/docs/reference/archon-directories.md:123-135`, `packages/docs-web/src/content/docs/reference/configuration.md:491-493`


### I-state-artifacts.9 Durable state documents (archon state)  —  couverture : **natif**

- YAML / CLI : ``archon state get|put|patch|log|list|delete <name> [--if-revision n] [--raw] [--install] [--prefix p] [--project key]`; node env `ARCHON_CLI_COMMAND`, `WORKFLOW_ID`, `ARCHON_NODE_EXECUTION`; table `remote_agent_state_revisions` / file store `state/<hash>/<revision>.json``

```yaml
nodes:
  - id: review
    prompt: Review the PR and return its identifier.
    output_format:
      type: object
      properties: { completed_pr: { type: string } }
      required: [completed_pr]
  - id: commit-state
    depends_on: [review]
    runtime: bun
    with: { completed_pr: $review.output.completed_pr }
    script: |
      const cmd: string[] = JSON.parse(process.env.ARCHON_CLI_COMMAND!);
      const p = Bun.spawn([...cmd, 'state', 'patch', 'review/ledger'], { stdin: 'pipe' });
      p.stdin.write(JSON.stringify({ ops: [{ op: 'append', path: '/seen', value: process.env.INPUTS_COMPLETED_PR }] }));
      p.stdin.end(); if (await p.exited !== 0) throw new Error('state commit failed');
```
- Ce qui manque ou diffère : Serialized JSON capped at 64 KiB (use artifact pointers for content); unavailable inside container-isolated nodes; the engine never injects a document into a prompt (nodes fetch explicitly); writer identity is provenance, not access control; a state commit and an external side effect are not one transaction; OpenCode agent-shell writes lose run identity.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1594-1685`, `packages/docs-web/src/content/docs/reference/cli.md:1734-1798`, `packages/docs-web/src/content/docs/reference/database.md:42`, `packages/docs-web/src/content/docs/reference/database.md:98-100`, `packages/docs-web/src/content/docs/reference/database.md:272-275`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:78`


### I-state-artifacts.10 Persistent sessions across re-runs (persist_session) and the cross-invocation scope artifacts  —  couverture : **partiel**

- YAML / CLI : `node `persist_session: true` / workflow `persist_sessions: true`; `output_type` on a persist node mirrors `nodes/<id>.md`+`.meta.json` into `artifacts/scopes/<workflow>/<scope>/`; `archon workflow reset-sessions <wf> [--scope k] [--node id] [--yes]`; `DELETE /api/workflows/{name}/node-sessions`; table `remote_agent_workflow_node_sessions``

```yaml
name: feature-dev
persist_sessions: true           # all AI nodes continue their prior conversation
nodes:
  - id: planner
    prompt: "Plan the implementation for: $ARGUMENTS"
    output_type: plan            # mirrored to the durable scope dir for cold recovery
  - id: validator
    bash: bun test
    persist_session: false
# archon workflow reset-sessions feature-dev --scope <conversation-uuid>
```
- Ce qui manque ou diffère : Scope is the launching conversation: `archon workflow run` and trigger runs have no scope (fresh every time, no scope artifacts); only fork-capable providers (Claude/Codex/Pi) continue, OpenCode/Copilot do not; not wired for `loop:`/`loop_group:`; last writer wins across concurrent runs; Codex fails hard when its saved thread is gone.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1164-1287`, `packages/docs-web/src/content/docs/reference/cli.md:1319-1335`, `packages/docs-web/src/content/docs/reference/cli.md:753-760`, `packages/docs-web/src/content/docs/reference/database.md:240-248`, `packages/docs-web/src/content/docs/reference/database.md:324-326`, `packages/docs-web/src/content/docs/reference/archon-directories.md:50`, `packages/docs-web/src/content/docs/reference/api.md:231`


### I-state-artifacts.11 In-run session ancestry and loop iteration state (context, fresh_context, $LOOP_PREV*, named owner sessions)  —  couverture : **partiel**

- YAML / CLI : ``context: fresh | shared | { resume: <node-id> }`; loop `fresh_context: true|false`; `$LOOP_PREV_OUTPUT`; `$LOOP_PREV.<nodeId>.output[.field]`; `$LOOP_PREV.<wait-id>.output.text``

```yaml
nodes:
  - id: implement
    prompt: Implement the requested change.
  - id: corrections
    depends_on: [implement]
    loop_group:
      max_iterations: 3
      fresh_context: true
      until_bash: 'test $review.output.done = true'
      nodes:
        - id: owner
          context: { resume: implement }      # one private branch of implement's session
          prompt: "Fix what review flagged: $LOOP_PREV.review.output"
        - id: review
          depends_on: [owner]
          context: fresh
          prompt: Review and report done.
          output_format: { type: object, properties: { done: { type: boolean } }, required: [done] }
```
- Ce qui manque ou diffère : Only the immediately prior iteration is reachable (no `[N]` history); a loop's `$node.output` is the last iteration only (accumulate in `$ARTIFACTS_DIR`); failure resume restarts a loop_group at iteration 1; the ambient session cursor is not rebuilt on resume; cross-run persistence is not wired for loop bodies.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:230`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:286-325`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1137`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:212-227`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:505-511`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:712-768`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:784-829`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:831-863`, `packages/docs-web/src/content/docs/reference/variables.md:34-35`


### I-state-artifacts.12 Durable run record: resume cache, output spills, terminal_record + artifact manifest, transcripts  —  couverture : **natif**

- YAML / CLI : ``always_run: true`; `archon workflow run <wf> --resume` / `archon workflow resume <id>`; `archon workflow get <id> --json [--verbose [--events]]` (`terminal_record`, `leave_behind.artifactFiles`, `sessionIds`, `transcript_path`, `checkout_baseline`); `archon workflow logs <id> [--follow] [--format text]`; `GET /api/workflows/runs/{runId}`; `~/.archon/workspaces/<project>/logs/<run-id>.jsonl``

```yaml
nodes:
  - id: fetch-data
    bash: ./scripts/download.sh > $ARTIFACTS_DIR/data.json
    always_run: true      # re-run on resume; the exit code doesn't validate the file
  - id: process-data
    prompt: "Summarize $ARTIFACTS_DIR/data.json"
    depends_on: [fetch-data]
# archon workflow get <run-id> --json --verbose   # terminal_record, artifact manifest, sessionIds
# archon workflow logs <run-id> --follow
```
- Ce qui manque ou diffère : The manifest holds metadata, never contents; `exec_output` tails are capped at 2000 chars; resume replays cached success unless `always_run`; there is no cross-run query by artifact type, only per-run inspection.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1109-1160`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1492-1529`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2827-2898`, `packages/docs-web/src/content/docs/reference/variables.md:139`, `packages/docs-web/src/content/docs/reference/node-execution.md:32-36`, `packages/docs-web/src/content/docs/reference/node-execution.md:54-58`, `packages/docs-web/src/content/docs/reference/node-execution.md:322-336`, `packages/docs-web/src/content/docs/reference/node-execution.md:367-371`, `packages/docs-web/src/content/docs/reference/cli.md:623`, `packages/docs-web/src/content/docs/reference/cli.md:712-760`, `packages/docs-web/src/content/docs/reference/cli.md:763-800`, `packages/docs-web/src/content/docs/reference/archon-directories.md:52`, `packages/docs-web/src/content/docs/reference/database.md:14-42`


### I-state-artifacts.13 Continuing a prior run's estate: --adopt and $ADOPTED_RUN_DIR  —  couverture : **partiel**

- YAML / CLI : ``archon workflow run <wf> --cwd <path> --adopt <run-id> [message]` (reuses worktree/branch, records `adopted_from_run_id`, exposes `$ADOPTED_RUN_DIR`); `--supersedes <run-id>` (fresh estate, provenance only)`

```yaml
archon workflow runs --open                       # find the prior run id
archon workflow run archon-ship --cwd /path/to/repo \
  --adopt 6d5066ca-47b4-4ee8-8d1d-2f3db8039190 "finish the delivery"
# the new run reuses that worktree/branch; prior artifacts are reachable via $ADOPTED_RUN_DIR
```
- Ce qui manque ou diffère : Exact run id only (no inference from branch/prompt); `$ADOPTED_RUN_DIR` is listed in the substitution order but has no dedicated reference entry; adoption reuses the checkout as-is (no fetch/sync); typed artifacts do not cross automatically, the next workflow must read the directory itself.
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:318-320`, `packages/docs-web/src/content/docs/reference/cli.md:346-347`, `packages/docs-web/src/content/docs/reference/cli.md:539-541`, `packages/docs-web/src/content/docs/reference/cli.md:1520-1528`, `packages/docs-web/src/content/docs/reference/variables.md:303`


### I-state-artifacts.14 evidence_policy deliverable marker  —  couverture : **partiel**

- YAML / CLI : `workflow-level `evidence_policy: { required: true }` → `$ARTIFACTS_DIR/evidence.json` must exist on the host before lifecycle completion`

```yaml
name: verified-block
evidence_policy: { required: true }   # run-owned; dropped with a warning on included blocks
nodes:
  - id: check
    bash: |
      bun test > "$ARTIFACTS_DIR/test.log"
      printf '{"tests":"green"}' > "$ARTIFACTS_DIR/evidence.json"
```
- Ce qui manque ou diffère : Presence-only: any contents satisfy it; proves neither that a check ran nor that an outcome was authored; run-owned, so it cannot be declared by a composable block.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1747`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2003-2010`, `packages/docs-web/src/content/docs/guides/container-isolation.md:106`


### I-state-artifacts.15 Attention-wait answers as typed node output (human input into a block)  —  couverture : **natif**

- YAML / CLI : ``wait: { attention: <text>, form: message|approval|select|multi_select, options: [...] }` → `$<id>.output.text|decision|decisions`; answered via `archon workflow answer`, `POST /api/workflows/runs/<id>/answer`, console; `$LOOP_PREV.<wait-id>.output.text` in a loop_group`

```yaml
nodes:
  - id: ask
    depends_on: [plan]
    wait:
      attention: "$plan.output.question"
      form: approval
  - id: drop
    cancel: "Rejected by reviewer"
    when: "$ask.output.decision == 'reject'"
  - id: post
    depends_on: [ask]
    when: "$ask.output.decision == 'approve'"
    bash: |
      text=$ask.output.text
      gh issue comment 123 --body "$text"
```
- Ce qui manque ou diffère : Carries only the answer (`text`/`decision`), not files; the run stays paused until a continuation host continues it; trigger-launched runs surface the question only in the console/CLI, not chat.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:851-880`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:605-632`, `packages/docs-web/src/content/docs/guides/proactive-workflows.md:30-37`


### I-state-artifacts.16 Getting run output into the repository (explicit copy node)  —  couverture : **partiel**

- YAML / CLI : `a `bash:` node that copies from `$ARTIFACTS_DIR` into the worktree and commits (documented sanctioned path 2 of 3)`

```yaml
nodes:
  - id: write-spec
    command: write-spec          # produces $ARTIFACTS_DIR/spec.md
  - id: commit-spec
    depends_on: [write-spec]
    bash: |
      cp "$ARTIFACTS_DIR/spec.md" docs/spec.md
      git add docs/spec.md && git commit -m "docs: add spec"
```
- Ce qui manque ou diffère : Pure convention; content left in an isolated worktree is destroyed at cleanup unless pushed/landed; the legacy in-repo `.archon/state/` convention is deprecated and only warned about, never migrated.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1687-1701`, `packages/docs-web/src/content/docs/reference/archon-directories.md:123-135`


### I-state-artifacts.17 SDLC pack artifact conventions (bundled example of the pattern)  —  couverture : **partiel**

- YAML / CLI : ``triage.md`, `investigation.md`, `plan.md`, `implementation.md`, `shape.md`, `discoveries.md` under `$ARTIFACTS_DIR`; `archon workflow run archon-plan --input report=<path>`; repo policy docs `.archon/sdlc/policy/rulings.md`, `.archon/sdlc/policy/maintainers.json``

```yaml
archon workflow run archon-investigate "Why does the export job time out?"
#  -> $ARTIFACTS_DIR/investigation.md
archon workflow run archon-plan --input report=/abs/path/to/investigation.md "Add CSV export"
#  -> plan.md ; archon-deliver then reads triage.md plus investigation.md or plan.md
```
- Ce qui manque ou diffère : Documented only: the pack's YAML and command files are not in this copy, so exact filenames and `--input` names cannot be verified here; cross-workflow handoff is by explicit path passed by a person or orchestrating agent.
- Citations : `packages/docs-web/src/content/docs/book/how-it-works.md:64-84`, `packages/docs-web/src/content/docs/book/how-it-works.md:128-132`, `packages/docs-web/src/content/docs/book/essential-workflows.md:92`, `packages/docs-web/src/content/docs/book/essential-workflows.md:114`, `packages/docs-web/src/content/docs/book/essential-workflows.md:144`, `packages/docs-web/src/content/docs/book/first-command.md:185`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:38-43`


### I-state-artifacts.18 Run attachments and Web UI uploads (external files into a run)  —  couverture : **partiel**

- YAML / CLI : ``POST /api/workflows/{name}/run` multipart `files=@<file>` (max 5 files, ≤10 MB each) plus `inputs={...}`; stored under `artifacts/uploads/<conv-id>/``

```yaml
curl -X POST http://localhost:3090/api/workflows/archon-investigate/run \
  -F "conversationId=conv-123" -F "message=Investigate this trace" \
  -F "files=@stacktrace.txt" -F 'inputs={"diff":"..."}'
```
- Ce qui manque ou diffère : Uploads are ephemeral and API/web only; the pages read here do not state the path a node uses to read an uploaded file.
- Citations : `packages/docs-web/src/content/docs/reference/api.md:334-342`, `packages/docs-web/src/content/docs/reference/archon-directories.md:51`


## J — Livrer un bloc comme skill ou comme code

Archon separates a block's two deliverable forms explicitly: prompt-form knowledge is an Archon `command:` (a markdown file in the workflow package's `commands/`, provider-agnostic, bound to a node) or a provider-native `skills:` entry (SKILL.md under `.claude/skills/`, exact per-node allowlist, Claude/Pi/Copilot with Codex using `$skill-name` text); code-form is a `bash:` or `script:` node (`runtime: bun|uv`, named files in the package's `scripts/`, shared modules in `<pack>/.shared/`). "Prefer code" in Archon terms is the engine's own governing rule, "YAML coordinates. Code computes. Agents judge." (AGENTS.md:98; cli.md:459): deterministic nodes own result contracts via `output_format` on bash/script producers, their exit code governs lifecycle status, `until_bash` lets code end an agent loop, `mutates_checkout: false` lets the engine verify a block wrote nothing, and `when:` gates on structured output instead of prose. Hooks, `allowed_tools`/`denied_tools`, `mcp:`, `plugins:` and `agents:` scope what an AI node may do rather than being deliverables themselves; they are largely Claude-only and (like skills) live under `.claude/` outside the workflow pack, which is the main portability gap for a reusable block. The bundled sdlc pack is absent from this copy.


### J-skills-vs-code.1 Commands (`command:` node + markdown command files)  —  couverture : **natif**

- YAML / CLI : `node `command: <name>`; file at `.archon/workflows/<pack>/<workflow>/commands/<name>.md` (packaged, package-local only) or shared `.archon/commands/<name>.md` / `~/.archon/commands/<name>.md` (legacy lookup repo > home > bundled); frontmatter `description`, `argument-hint`; body uses `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$INPUTS.<name>` (bound via node `with:`)`

```yaml
# .archon/workflows/my-pack/research/research.yaml
name: research
nodes:
  - id: gather
    command: gather-sources      # my-pack/research/commands/gather-sources.md
    with:
      topic: $ARGUMENTS
# --- commands/gather-sources.md ---
# ---
# description: Gather sources for a topic
# argument-hint: <topic>
# ---
# **Input**: $INPUTS.topic
# Write findings to $ARTIFACTS_DIR/research/sources.md
```
- Citations : `packages/docs-web/src/content/docs/guides/authoring-commands.md:16-23`, `packages/docs-web/src/content/docs/guides/authoring-commands.md:29-31`, `packages/docs-web/src/content/docs/guides/authoring-commands.md:37-57`, `packages/docs-web/src/content/docs/guides/authoring-commands.md:61-65`, `packages/docs-web/src/content/docs/guides/authoring-commands.md:230`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:48-66`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:212`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1289-1324`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1859-1874`, `packages/docs-web/src/content/docs/book/first-command.md:19-25`, `packages/docs-web/src/content/docs/book/first-command.md:181-185`, `packages/docs-web/src/content/docs/guides/global-workflows.md:56-62`, `packages/docs-web/src/content/docs/guides/global-workflows.md:165-184`, `packages/docs-web/src/content/docs/getting-started/concepts.md:70-72`, `packages/docs-web/src/content/docs/getting-started/concepts.md:86`, `packages/docs-web/src/content/docs/book/dag-workflows.md:250-261`


### J-skills-vs-code.2 Per-node skills (`skills:`, provider-native SKILL.md)  —  couverture : **partiel**

- YAML / CLI : `AI node `skills: [name, ...]` (exact allowlist; omission or `[]` = none); files at `.claude/skills/<name>/SKILL.md` (Claude) or `.agents/skills/` (Codex native, also searched by Pi/Copilot); install with `npx skills add owner/repo [--skill name] [-g]`; Codex: no `skills:` list, write `Use $skill-name to ...` in the command/prompt`

```yaml
nodes:
  - id: classify
    prompt: "Classify this task"      # no skills: lean, cheap
  - id: implement
    prompt: "Write the code"
    skills: [code-conventions, testing-patterns]
  - id: review
    prompt: "Review the code"
    skills: [code-review]
```
- Ce qui manque ou diffère : A skill is knowledge injected into one AI node's context, never a block or node by itself and never a workflow deliverable: it has no output, no contract, no run record. Must be pre-installed on disk (no on-demand fetch); Claude resolves only `.claude/skills/` under an enabled `settingSources`; Codex fails the run on a non-empty `skills:` and needs explicit `$skill-name` text; OpenCode unsupported; container runs see only project-local skills. Skills live under `.claude/` / `.agents/`, outside the workflow pack, so a pack cannot carry them.
- Citations : `packages/docs-web/src/content/docs/guides/skills.md:12-22`, `packages/docs-web/src/content/docs/guides/skills.md:26-44`, `packages/docs-web/src/content/docs/guides/skills.md:46-61`, `packages/docs-web/src/content/docs/guides/skills.md:65-89`, `packages/docs-web/src/content/docs/guides/skills.md:97-122`, `packages/docs-web/src/content/docs/guides/skills.md:126-144`, `packages/docs-web/src/content/docs/guides/skills.md:164-191`, `packages/docs-web/src/content/docs/guides/skills.md:215-216`, `packages/docs-web/src/content/docs/guides/skills.md:243-249`, `packages/docs-web/src/content/docs/guides/skills.md:269-277`, `packages/docs-web/src/content/docs/guides/skills.md:279-292`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:203`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:250`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:25-29`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:68`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:291-299`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:723`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:816`, `AGENTS.md:90-92`


### J-skills-vs-code.3 Setting sources (`settingSources`) — which filesystem instructions, skills, commands, agents and native hooks a Claude node may see  —  couverture : **partiel**

- YAML / CLI : `node `settingSources: ['project'] | ['user'] | ['project','user'] | []`; config `assistants.claude.settingSources:` in `.archon/config.yaml` / `~/.archon/config.yaml``

```yaml
nodes:
  - id: lean-review
    command: review
    settingSources: []            # no CLAUDE.md, skills, agents or native hooks
  - id: implement
    command: implement
    settingSources: ['project']   # <cwd>/.claude/ only; ~/.claude/ excluded
    skills: [code-conventions]    # must live under an enabled source
```
- Ce qui manque ou diffère : Claude only (other providers warn and ignore). `.claude/settings.local.json` is never loaded. Eligibility only: it does not activate skills (that is `skills:`).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:259`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:395-407`, `packages/docs-web/src/content/docs/guides/hooks.md:79-95`, `packages/docs-web/src/content/docs/guides/hooks.md:144-148`, `packages/docs-web/src/content/docs/reference/configuration.md:291-322`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:157-169`, `packages/docs-web/src/content/docs/guides/skills.md:146-159`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:83`


### J-skills-vs-code.4 Plugins (`plugins:`) — Claude Code / Codex plugins loaded exactly by name  —  couverture : **partiel**

- YAML / CLI : `AI node `plugins: [name@marketplace]` (ids as `claude plugin list` / `codex plugin list` print); plugin skills still via `skills: [plugin:skill]` (Codex `$<plugin>:<skill>`); plugin MCP servers restated in the node's `mcp:` file as `plugin:<plugin>:<server>``

```yaml
- id: triage
  prompt: Find the noisiest error groups from the last day.
  plugins: [posthog@claude-plugins-official]
  skills: [posthog:investigating-error-issue]
  mcp: .archon/mcp/posthog.json
```
- Ce qui manque ou diffère : Claude and Codex only (other providers fail the run before any node). Nodes start with zero user plugins; a named plugin's MCP servers must be re-declared and stdio / `${CLAUDE_PLUGIN_ROOT}` servers cannot be restated. Node fails if an unnamed plugin is reported loaded.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:251`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:409-427`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:302-330`, `packages/docs-web/src/content/docs/guides/skills.md:255-257`, `packages/docs-web/src/content/docs/guides/skills.md:289-292`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:69`


### J-skills-vs-code.5 `bash:` nodes — deterministic shell step, code deliverable  —  couverture : **natif**

- YAML / CLI : `node `bash: "<shell>"`; optional `timeout` (ms, default 120000), `on_timeout: skip`, `output_format`, `when:`, `retry:`, `mutates_checkout: false`; stdout → `$nodeId.output`; `$ARGUMENTS`/`$USER_MESSAGE`/`INPUTS_<UPPER_SNAKE>` arrive as env vars`

```yaml
nodes:
  - id: implement
    command: implement-feature
  - id: verify
    bash: "bun run type-check && bun test"   # non-zero exit fails the node
    depends_on: [implement]
  - id: report
    prompt: "Summarize the result: $verify.output"
    depends_on: [verify]
```
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:214`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:261-284`, `packages/docs-web/src/content/docs/book/dag-workflows.md:252`, `packages/docs-web/src/content/docs/book/dag-workflows.md:263-273`, `packages/docs-web/src/content/docs/book/dag-workflows.md:341-343`, `packages/docs-web/src/content/docs/guides/hooks.md:65`, `packages/docs-web/src/content/docs/guides/script-nodes.md:353-355`, `packages/docs-web/src/content/docs/getting-started/what-archon-is-not.md:16`, `packages/docs-web/src/content/docs/getting-started/concepts.md:42`


### J-skills-vs-code.6 `script:` nodes — TypeScript/JS (bun) or Python (uv), inline or named, with pack-shared modules  —  couverture : **natif**

- YAML / CLI : `node `script: <inline code | bare-name>` + `runtime: bun | uv` (required); `deps: [...]` (uv only); `timeout`, `on_timeout: skip`, `output_format`, `with:`; named files at `.archon/workflows/<pack>/<workflow>/scripts/<name>.ts|.py` (packaged) or `.archon/scripts/` / `~/.archon/scripts/` (legacy); shared code in `<pack>/.shared/``

```yaml
nodes:
  - id: classify
    script: classify-severity      # my-pack/triage/scripts/classify-severity.ts
    runtime: bun
    timeout: 60000
    output_format:
      type: object
      properties:
        severity: { type: string, enum: [low, high] }
      required: [severity]
  - id: investigate
    command: investigate-bug
    depends_on: [classify]
    when: "$classify.output.severity == 'high'"
```
- Citations : `packages/docs-web/src/content/docs/guides/script-nodes.md:12-20`, `packages/docs-web/src/content/docs/guides/script-nodes.md:48-59`, `packages/docs-web/src/content/docs/guides/script-nodes.md:63-89`, `packages/docs-web/src/content/docs/guides/script-nodes.md:93-133`, `packages/docs-web/src/content/docs/guides/script-nodes.md:135-149`, `packages/docs-web/src/content/docs/guides/script-nodes.md:151-164`, `packages/docs-web/src/content/docs/guides/script-nodes.md:166-202`, `packages/docs-web/src/content/docs/guides/script-nodes.md:346-349`, `packages/docs-web/src/content/docs/guides/script-nodes.md:462-478`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:215`, `packages/docs-web/src/content/docs/book/dag-workflows.md:253`, `packages/docs-web/src/content/docs/book/dag-workflows.md:275-284`, `packages/docs-web/src/content/docs/reference/archon-directories.md:101-121`


### J-skills-vs-code.7 Result contracts owned by code: `output_format` on bash/script producers + workflow signature `inputs:` / `returns:` / `outcome_field:` + `with:` bindings  —  couverture : **natif**

- YAML / CLI : `workflow-level `inputs: { name: { required|default, description } }`, `returns: <node-id>`, `outcome_field: <bool prop>`; node `output_format:` (JSON Schema) on `bash:`/`script:`; caller `with: { name: $node.output.field }`; block reads `$INPUTS.<name>` (prompt/command) or `INPUTS_<UPPER_SNAKE>` env (bash/script); `archon workflow run <name> --input name=value``

```yaml
name: plan-block
inputs:
  diff: { required: true }
returns: build
outcome_field: ready
nodes:
  - id: build
    script: build-plan-result     # reads process.env.INPUTS_DIFF, prints one JSON doc
    runtime: uv
    output_format:
      type: object
      properties:
        ready: { type: boolean }
        units: { type: array, items: { type: object } }
      required: [ready, units]
```
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:154-159`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:245`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:710-748`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1289-1324`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1919-1981`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2028-2043`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2087-2120`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2808-2825`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2900-2932`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3006-3060`, `packages/docs-web/src/content/docs/guides/script-nodes.md:276-315`


### J-skills-vs-code.8 Governing rule "YAML coordinates. Code computes. Agents judge." — deterministic checks govern lifecycle status  —  couverture : **natif**

- YAML / CLI : ``bash:`/`script:` exit code → node completed/failed (lifecycle); `outcome_field:` → authored verdict; `evidence_policy: { required: true }` → `$ARTIFACTS_DIR/evidence.json` must exist; complex decisions computed in a node and gated with `when:` on `output_format` fields (no growing `when:` operators)`

```yaml
nodes:
  - id: decide
    script: compute-decision        # the logic lives in code, not in when:
    runtime: bun
    output_format:
      type: object
      properties: { proceed: { type: boolean } }
      required: [proceed]
  - id: ship
    command: ship
    depends_on: [decide]
    when: "$decide.output.proceed == true"
```
- Citations : `AGENTS.md:96-106`, `packages/docs-web/src/content/docs/reference/cli.md:459`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1993-2010`, `packages/docs-web/src/content/docs/guides/hooks.md:67-77`, `packages/docs-web/src/content/docs/book/dag-workflows.md:341-343`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3488-3516`, `packages/docs-web/src/content/docs/book/essential-workflows.md:215-225`


### J-skills-vs-code.9 Loop completion by code: `until_bash` (and `until_field` for model-judged completion)  —  couverture : **natif**

- YAML / CLI : ``loop: { prompt|command, max_iterations, until_bash: "<shell>" }` with node-level `timeout` for the check; `until_field: <bool prop of output_format>`; `loop_group` + `until_bash` for multi-node bodies`

```yaml
- id: fix-tests
  timeout: 900000                 # budget for each until_bash check
  loop:
    prompt: Run the test suite. Read the failures. Fix them one at a time.
    max_iterations: 8
    until_bash: "bun run test"    # the only way out is a passing suite
    fresh_context: false
```
- Citations : `packages/docs-web/src/content/docs/guides/loop-nodes.md:229-285`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:287-341`, `packages/docs-web/src/content/docs/guides/loop-nodes.md:433-466`


### J-skills-vs-code.10 Per-node hooks: static YAML `hooks:` vs native Claude hooks in `.claude/settings.json`  —  couverture : **partiel**

- YAML / CLI : `node `hooks: { PreToolUse|PostToolUse|...: [{ matcher: "<regex>", response: <SyncHookJSONOutput>, timeout }] }`; computed logic instead in `.claude/settings.json` `"hooks"` entries of `"type": "command"` (loaded per `settingSources`)`

```yaml
- id: implement
  command: implement-changes
  settingSources: ['project']   # project .claude/settings.json command hooks run
  hooks:                         # static: same response every time, readable in YAML
    PostToolUse:
      - matcher: "Write|Edit"
        response:
          hookSpecificOutput:
            hookEventName: PostToolUse
            additionalContext: "Re-read the file, then run bun run type-check."
```
- Ce qui manque ou diffère : Claude only (others warn and ignore). YAML hooks are deliberately static — no `command:`/`http:`/`prompt:`/`agent:` hook types in workflow YAML; input-aware logic must live in `.claude/settings.json` + hook scripts, i.e. in Claude configuration outside the workflow pack. YAML hooks emit no `hook` run events. Hooks apply pressure, they do not guarantee compliance (hooks-and-quality.md:142).
- Citations : `packages/docs-web/src/content/docs/guides/hooks.md:12-21`, `packages/docs-web/src/content/docs/guides/hooks.md:41-57`, `packages/docs-web/src/content/docs/guides/hooks.md:59-77`, `packages/docs-web/src/content/docs/guides/hooks.md:79-95`, `packages/docs-web/src/content/docs/guides/hooks.md:97-142`, `packages/docs-web/src/content/docs/guides/hooks.md:150-177`, `packages/docs-web/src/content/docs/guides/hooks.md:387-399`, `packages/docs-web/src/content/docs/guides/hooks.md:401-426`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:114-144`, `packages/docs-web/src/content/docs/book/hooks-and-quality.md:183-191`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:67`


### J-skills-vs-code.11 Tool restrictions (`allowed_tools` / `denied_tools`)  —  couverture : **partiel**

- YAML / CLI : `AI node `allowed_tools: [Read, Grep, Glob]` (whitelist; `[]` = no built-in tools), `denied_tools: [WebSearch, WebFetch]` (applied after); `Skill` tool kept automatically when `skills:` declared; MCP wildcards `mcp__<server>__*` added automatically`

```yaml
nodes:
  - id: review
    command: code-review
    allowed_tools: [Read, Grep, Glob]   # read-only reviewer
  - id: query-db
    prompt: "Find users who signed up in the last 24h"
    mcp: .archon/mcp/postgres.json
    allowed_tools: []                   # MCP-only sandbox
```
- Ce qui manque ou diffère : Not enforced on Codex (warn and continue), so `allowed_tools: []` is not a sandbox there. Include/exclude only; no context injection or input rewriting (that is `hooks:`).
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:246-247`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:750-772`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:239-250`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:264-281`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:476-484`, `packages/docs-web/src/content/docs/guides/hooks.md:387-399`, `packages/docs-web/src/content/docs/guides/skills.md:79-81`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:71`


### J-skills-vs-code.12 Per-node MCP servers (`mcp:`) — capability delivery (tools) as opposed to skills (process)  —  couverture : **partiel**

- YAML / CLI : `AI node `mcp: .archon/mcp/<file>.json` (required) or `mcp: { path: ..., optional: true }`; JSON `{ "<server>": { "command", "args", "env" } | { "type": "http"|"sse", "url", "headers" } }` with `$VAR` expansion in `env`/`headers`; nodes get no ambient MCP`

```yaml
- id: create-pr
  prompt: "Create a PR with the changes"
  skills: [pr-conventions]        # teaches HOW (process)
  mcp: .archon/mcp/github.json    # provides the tools (capability)
# .archon/mcp/github.json:
# { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
#               "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "$GITHUB_TOKEN" } } }
```
- Ce qui manque ou diffère : No inline config — must be a separate JSON file (gitignored `.archon/mcp/` reaches a worktree only via `worktree.copyFiles`). Pi/OpenCode: a required `mcp:` fails the run before start. Codex ignores `allowed_tools`, so MCP-only sandboxing is Claude-only. Haiku has no tool search.
- Citations : `packages/docs-web/src/content/docs/guides/mcp-servers.md:12-23`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:25-51`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:53-66`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:109-113`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:115-137`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:190-219`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:218-231`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:239-250`, `packages/docs-web/src/content/docs/guides/mcp-servers.md:486-496`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:249`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:66`, `AGENTS.md:90`


### J-skills-vs-code.13 Inline sub-agents (`agents:`) vs on-disk `.claude/agents/*.md`  —  couverture : **partiel**

- YAML / CLI : `AI node `agents: { <kebab-id>: { description, prompt, model?, tools?, disallowedTools?, skills?, maxTurns? } }`; main agent spawns them via `Task(subagent_type=...)`; on-disk agents in `.claude/agents/` picked up by the SDK when `settingSources` allows`

```yaml
- id: triage
  prompt: Spawn brief-gen per issue in parallel, then cluster duplicates.
  model: sonnet
  allowed_tools: [Bash, Read, Write, Task]
  agents:
    brief-gen:
      description: Summarises one GitHub issue in 2-3 sentences
      prompt: Return JSON { summary, primarySymptom, affectedArea }.
      model: haiku
      tools: [Bash, Read]
```
- Ce qui manque ou diffère : Claude only (Copilot maps a subset; OpenCode = named config agents). Sub-agents are prompt deliverables inside one node, not governed nodes: no `output_format` contract, no artifact chain, no run record, no deterministic checks between them.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:252`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:774-809`, `packages/docs-web/src/content/docs/reference/provider-capabilities.md:70`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:818`


### J-skills-vs-code.14 Engine-verified read-only block (`mutates_checkout: false` on a node)  —  couverture : **natif**

- YAML / CLI : `node `mutates_checkout: false` (on `command`/`prompt`/`bash`/`script`); workflow-level `mutates_checkout: false` skips the path lock so N runs share a checkout`

```yaml
nodes:
  - id: review
    command: code-review
    mutates_checkout: false   # engine diffs git status before/after; fails naming changed paths
```
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:141-145`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:235`


### J-skills-vs-code.15 Packaged workflows and workflow packs — shipping a block as code (YAML + commands/ + scripts/ + .shared/) and composing it  —  couverture : **partiel**

- YAML / CLI : `layout `.archon/workflows/<pack>/<workflow>/{<workflow>.yaml, commands/, scripts/}` + `<pack>/.shared/`; compose with `include: <name>` / `workflow: <name>`; publish with `archon-plugin.json` (`"kind": "workflow-pack"`, `"entrypoints"`); `archon plugin add owner/repo[/path][@tag]`, `archon plugin update|remove|list`, `archon plugin copy <id>`; run as `owner/plugin:entrypoint``

```yaml
review-kit/                     # plugin root (owner/repo[/path])
├── archon-plugin.json          # {"kind":"workflow-pack","entrypoints":{"review":"review/review.yaml"}}
├── .shared/util.ts             # modules shared by the pack's scripts
├── review/
│   ├── review.yaml             # entrypoint; nodes: - include: helper
│   ├── commands/scope.md       # prompt deliverable, package-local
│   └── scripts/check.ts        # code deliverable, package-local
└── helper/
    ├── helper.yaml             # support workflow: only reachable via include:
    └── commands/summarize.md
```
- Ce qui manque ou diffère : A pack carries YAML, commands, scripts and .shared modules only: the manifest forbids dependencies/install scripts, so skills (`.claude/skills/`), native hooks (`.claude/settings.json`), on-disk agents and MCP JSON (`.archon/mcp/`) cannot ship inside it. Private GitHub repos cannot be installed (manifest read unauthenticated). `include:` targets are literal names, max 3 levels deep.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:38-42`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:46-66`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1703-1734`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1899-1915`, `packages/docs-web/src/content/docs/guides/global-workflows.md:38-62`, `packages/docs-web/src/content/docs/guides/global-workflows.md:64-103`, `packages/docs-web/src/content/docs/guides/publishing-plugins.md:8-25`, `packages/docs-web/src/content/docs/reference/cli.md:167-194`, `packages/docs-web/src/content/docs/guides/script-nodes.md:155-164`, `packages/docs-web/src/content/docs/reference/configuration.md:258-261`


### J-skills-vs-code.16 `archon skill add` — the bundled `archon-cli` skill (a skill that teaches an agent to drive Archon)  —  couverture : **partiel**

- YAML / CLI : ``archon skill add [path]` (also run by `archon setup`); writes `.claude/skills/archon-cli/` and `.agents/skills/archon-cli/`; deprecated alias `archon skill install``

```yaml
archon skill add                 # -> ./.claude/skills/archon-cli/ and ./.agents/skills/archon-cli/
archon skill add /path/to/project
# then on a node: skills: [archon-cli]  (Claude)  or  "Use $archon-cli ..." (Codex)
```
- Ce qui manque ou diffère : Installs only Archon's own `archon-cli` skill; it is not a general skill manager. Third-party skills are installed outside Archon with `npx skills add` (skills.md:97-122).
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:1594-1613`, `packages/docs-web/src/content/docs/guides/skills.md:197`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md:296-297`, `packages/cli/src/commands/skill.ts:1-11`, `packages/cli/src/commands/skill.ts:45-59`, `packages/cli/src/bundled-skill.ts:1-44`


### J-skills-vs-code.17 Validating a block and testing its own checks: `archon validate workflows|commands`, deterministic dry-run with stubs and `--exec-code`  —  couverture : **partiel**

- YAML / CLI : ``archon validate workflows [name] [--json]`; `archon validate commands [name]`; `archon workflow run <name> --dry-run --stubs <file> [--default-stubs] [--exec-code] [--input k=v] [--json]`; `--dry-run --stubs-init <file>` to scaffold`

```yaml
archon validate workflows my-block          # YAML, DAG, command files, MCP json, skill dirs, provider compat
archon workflow run my-block --cwd . \
  --dry-run --stubs-init fixtures/my-block.yaml
archon workflow run my-block --cwd . \
  --dry-run --stubs fixtures/my-block.yaml --exec-code --json \
  | jq '.outcome, .authoredOutcome, .missingStubs'
```
- Ce qui manque ou diffère : Validates wiring and, with `--exec-code`, runs the block's bash/script checks against stubbed AI output, but never exercises model reasoning (cli.md:459). `validate commands` checks only existence, non-empty and valid name. No recorded 'verified' status on a workflow; `--exec-code` runs bash/script nodes for real (side effects).
- Citations : `packages/docs-web/src/content/docs/reference/cli.md:408-459`, `packages/docs-web/src/content/docs/reference/cli.md:1492-1517`, `packages/docs-web/src/content/docs/guides/script-nodes.md:370-385`, `packages/docs-web/src/content/docs/guides/global-workflows.md:256-260`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:3692-3714`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:2823-2825`, `packages/docs-web/src/content/docs/guides/authoring-commands.md:643-648`


### J-skills-vs-code.18 Extra command folder (`commands.folder`) — reusing Claude Code slash-command files as Archon commands  —  couverture : **partiel**

- YAML / CLI : ``.archon/config.yaml` → `commands: { folder: <path>, autoLoad: true }`; search order `.archon/commands/` then the configured folder; `defaults.loadDefaultCommands: false` to drop bundled ones`

```yaml
# .archon/config.yaml
commands:
  folder: .claude/commands/archon   # additional folder searched after .archon/commands/
  autoLoad: true
```
- Ce qui manque ou diffère : One extra legacy search folder only; packaged workflows still resolve `command:` solely from their own `commands/` (authoring-workflows.md:62). Claude's `!bash` lines in such files are not executed by Archon.
- Citations : `packages/docs-web/src/content/docs/reference/configuration.md:228-231`, `packages/docs-web/src/content/docs/reference/configuration.md:743-753`, `packages/docs-web/src/content/docs/reference/configuration.md:415`, `packages/docs-web/src/content/docs/reference/archon-directories.md:261-273`


### J-skills-vs-code.19 Inline `prompt:` and per-node `systemPrompt:` — one-off instructions that are not a reusable deliverable  —  couverture : **partiel**

- YAML / CLI : `node `prompt: "..."` (mutually exclusive with `command:`); `systemPrompt: "..."` (per-node only; replaces Claude's `claude_code` preset, Codex puts it in the user prompt, Copilot appends)`

```yaml
- id: security-review
  prompt: "Review this diff for vulnerabilities: $fetch-diff.output"
  systemPrompt: "You are a security expert specializing in TypeScript. Focus only on security issues."
  depends_on: [fetch-diff]
```
- Ce qui manque ou diffère : Not reusable across workflows (that is what `command:` files are for); `systemPrompt` is per-node only, no workflow-level default.
- Citations : `packages/docs-web/src/content/docs/guides/authoring-workflows.md:213`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:255`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:327-329`, `packages/docs-web/src/content/docs/guides/authoring-workflows.md:356-362`, `packages/docs-web/src/content/docs/book/dag-workflows.md:251`, `packages/docs-web/src/content/docs/book/dag-workflows.md:261`, `packages/docs-web/src/content/docs/book/first-command.md:181`

