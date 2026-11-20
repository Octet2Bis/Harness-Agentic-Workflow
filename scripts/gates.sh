#!/usr/bin/env bash
# Toutes les portes, dans l'ordre d'AGENTS.md. Le méta-test passe en premier.
#   scripts/gates.sh            (ARCHON_CMD / ARCHON_SRC comme verify-block.sh)
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
status=0
run() { echo; echo "▶ $*"; "$@" || status=1; }

run bun "$root/scripts/gates/test-gates-can-fail.ts"
run bun "$root/scripts/gates/validate.ts"
run bun "$root/scripts/gates/build-harness.ts" --check
run bun test "$root/scripts"
run bun test "$root/integrations"
run "$root/scripts/verify-block.sh" --all

echo
if [[ $status -eq 0 ]]; then echo "✅ Toutes les portes passent"; else echo "❌ Une porte au moins a échoué"; fi
exit $status
