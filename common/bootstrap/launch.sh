#!/usr/bin/env bash
# Inicia uma pipeline: garante o Node, as dependencias da TUI e executa src/main.js da pipeline.
# Uso: launch.sh <diretorio-da-pipeline> [argumentos...]
set -euo pipefail

BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_TUI_DIR="$BOOTSTRAP_DIR/../tui"
PIPELINE_DIR="${1:?Uso: launch.sh <diretorio-da-pipeline> [argumentos...]}"
shift

# shellcheck source=ensure-node.sh
source "$BOOTSTRAP_DIR/ensure-node.sh"
ensure_node

if [[ ! -d "$COMMON_TUI_DIR/node_modules" ]]; then
    npm --prefix "$COMMON_TUI_DIR" ci --no-audit --no-fund --silent
fi

exec node "$PIPELINE_DIR/src/main.js" "$@"
