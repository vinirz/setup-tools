#!/usr/bin/env bash
# Entrada da pipeline do zsh: garante o Node e delega para a pipeline em Node.
# Uso: ./install.sh [--no-chsh] [--help]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=../common/bootstrap/ensure-node.sh
source "$ROOT/common/bootstrap/ensure-node.sh"
ensure_node

if [[ ! -d "$ROOT/common/tui/node_modules" ]]; then
    npm --prefix "$ROOT/common/tui" ci --no-audit --no-fund --silent
fi

exec node "$ROOT/zsh/src/main.js" "$@"
