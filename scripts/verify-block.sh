#!/usr/bin/env bash
# Vérifie un bloc (ou un système) de bout en bout, sans appeler de modèle :
#   scripts/verify-block.sh <workflow-name> [<workflow-name>...]
#   scripts/verify-block.sh --all
#
# 0. scripts/gates/validate.ts --workflow=<name> (R1, R2, R3, R5, R6 en lecture statique :
#    boucle qui rend la main, compteur `tries`, juge, fixtures déclarées…) : une violation
#    de ce workflow, des blocs qu'il inclut (`include:`, de proche en proche), ou de tout le
#    dépôt (registre, déclencheurs), fait échouer ; celle d'un autre workflow non (un chantier
#    voisin ne bloque pas la vérification). Les sous-runs `workflow:` sont des runs à part :
#    hors de cette vérification, chacun passe par verify-block.sh <son nom> ;
# 1. tests unitaires des contrôles (bun test sur .archon/workflows/**/*.test.ts, .shared/ compris :
#    io.test.ts y prouve le compteur de tours `nextTry`) ;
# 2. archon validate workflows <name> ;
# 3. archon workflow test <dossier du workflow> (les fixtures, une par issue : nœuds atteints,
#    état final) — par chemin, pas par nom : `workflow test implement` lancerait aussi les
#    fixtures du pack sdlc livré avec Archon (`sdlc/implement`), dont le dossier porte le même nom ;
# 4. scripts/gates/fixture-outcomes.ts <name> (ce que rend chaque fixture : ses lignes
#    « # attendu: ok=false status=rejected » contre la sortie réelle de verdict/done).
# Tout vert (étapes 0 à 4) = VERIFIED. Le registre (blocks/REGISTRY.md) se met à jour à la main, avec la date.
#
# La commande Archon vient de $ARCHON_CMD (défaut : `archon` sur le PATH). Sans binaire
# installé, depuis un checkout du dépôt Archon (après `bun install`) :
#   ARCHON_SRC=/chemin/vers/Archon scripts/verify-block.sh --all
# ce qui équivaut à ARCHON_CMD="bun /chemin/vers/Archon/packages/cli/src/cli.ts".
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# Pas de sous-shell autour de `run` : un `status=1` posé dans `( … )` serait perdu.
cd "$root" || exit 2
if [[ -n "${ARCHON_CMD:-}" ]]; then
  archon="$ARCHON_CMD"
elif [[ -n "${ARCHON_SRC:-}" ]]; then
  archon="bun $ARCHON_SRC/packages/cli/src/cli.ts"
else
  archon="archon"
fi
status=0

run() {
  echo
  echo "▶ $*"
  "$@" || status=1
}

# Les workflows du dépôt (gabarit compris) : nom (`name:`) → dossier.
declare -A dir_of=()
all_names=()
while IFS= read -r file; do
  wf_name="$(sed -n 's/^name: *//p' "$file" | head -1 | tr -d '\r')"
  dir_of["$wf_name"]="$(dirname "$file")"
  all_names+=("$wf_name")
done < <(find "$root/.archon/workflows" -mindepth 3 -maxdepth 3 -name '*.yaml' | sort)

names=("$@")
if [[ "${1:-}" == "--all" ]]; then
  names=("${all_names[@]}")
fi
if [[ ${#names[@]} -eq 0 ]]; then
  echo "usage: scripts/verify-block.sh <workflow-name>... | --all" >&2
  exit 2
fi
for name in "${names[@]}"; do
  if [[ -z "${dir_of[$name]:-}" ]]; then
    echo "workflow inconnu dans ce dépôt : $name (noms : ${all_names[*]})" >&2
    exit 2
  fi
done

echo "== 0. Règles statiques (validate.ts) : ${names[*]}"
scope=()
if [[ "${1:-}" != "--all" ]]; then
  for name in "${names[@]}"; do scope+=("--workflow=$name"); done
fi
# `${scope[@]+…}` : un tableau vide sous `set -u` casse bash < 4.4.
run bun "$root/scripts/gates/validate.ts" "--root=$root" ${scope[@]+"${scope[@]}"}

echo
echo "== 1. Tests unitaires des contrôles"
tests=()
while IFS= read -r file; do tests+=("$file"); done < <(find "$root/.archon/workflows" -name '*.test.ts' | sort)
if [[ ${#tests[@]} -gt 0 ]]; then
  run bun test "${tests[@]}"
else
  echo "(aucun test)"
fi

for name in "${names[@]}"; do
  echo
  echo "== 2. Validation : $name"
  # shellcheck disable=SC2086
  run $archon validate workflows "$name" --cwd "$root"
  echo
  echo "== 3. Fixtures : $name"
  # shellcheck disable=SC2086
  run $archon workflow test "${dir_of[$name]#"$root"/}" --cwd "$root"
done

echo
echo "== 4. Issues des fixtures : ${names[*]}"
run bun "$root/scripts/gates/fixture-outcomes.ts" "${names[@]}"

echo
if [[ $status -eq 0 ]]; then
  echo "✅ VERIFIED : ${names[*]}"
else
  echo "❌ Des vérifications ont échoué : ${names[*]}"
fi
exit $status
