#!/usr/bin/env bash
# Entrada da pipeline suite-dev. Uso: ./install.sh [--help]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../common/bootstrap/launch.sh" "$HERE" "$@"
