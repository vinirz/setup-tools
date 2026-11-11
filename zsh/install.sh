#!/usr/bin/env bash
# Entrada da pipeline do zsh. Uso: ./install.sh [--no-chsh] [--help]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../common/bootstrap/launch.sh" "$HERE" "$@"
