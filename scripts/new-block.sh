#!/usr/bin/env bash
# Crée un nouveau bloc à partir du gabarit : scripts/new-block.sh <nom>
# Le nom devient le dossier blocks/<nom>/ et le nom du workflow (`name:`), en kebab-case.
set -euo pipefail

name="${1:-}"
if [[ -z "$name" || ! "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "usage: scripts/new-block.sh <nom-en-kebab-case>" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/.archon/workflows/blocks/template"
dst="$root/.archon/workflows/blocks/$name"

if [[ -e "$dst" ]]; then
  echo "blocks/$name existe déjà" >&2
  exit 1
fi

cp -R "$src" "$dst"
mv "$dst/block-template.yaml" "$dst/$name.yaml"
sed -i.bak "s/^name: block-template$/name: $name/" "$dst/$name.yaml" && rm -f "$dst/$name.yaml.bak"
sed -i.bak "s/Bloc \`block-template\` — gabarit/Bloc \`$name\`/; s/Statut : \*\*GABARIT\*\*.*/Statut : **DRAFT**/" "$dst/README.md" && rm -f "$dst/README.md.bak"

cat <<EOF
Bloc créé : .archon/workflows/blocks/$name/
  1. commands/work.md   — décris le métier
  2. scripts/check.ts   — adapte RULES
  3. commands/judge.md  — ce que le juge doit regarder
  4. fixtures/          — une fixture par issue
  5. scripts/verify-block.sh $name
EOF
