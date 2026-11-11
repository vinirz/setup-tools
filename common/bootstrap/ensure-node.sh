#!/usr/bin/env bash
# Garante Node.js disponivel para as pipelines, sem depender do zsh.
# Parte puramente bash: roda antes da TUI (que e feita em Node). Idempotente.
# Uso: ./ensure-node.sh
set -euo pipefail

readonly MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-22}"
readonly NODE_VERSION="${NODE_VERSION:-lts/*}"
readonly NVM_RELEASE="${NVM_RELEASE:-v0.39.5}"
readonly NVM_INSTALL_URL="https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_RELEASE/install.sh"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { warn "$*"; exit 1; }

nvm_dir() { printf '%s' "${NVM_DIR:-$HOME/.nvm}"; }

node_major() {
    command -v node >/dev/null || { echo 0; return; }
    node --version | sed -E 's/^v([0-9]+).*/\1/'
}

node_is_sufficient() { (( $(node_major) >= MIN_NODE_MAJOR )); }

install_prerequisites() {
    command -v curl >/dev/null && command -v git >/dev/null && return
    command -v apt-get >/dev/null || die 'Instale curl e git manualmente (apt nao encontrado).'
    log 'Instalando curl e git...'
    sudo apt-get update -qq
    sudo apt-get install -y curl git
}

install_nvm() {
    [[ -s "$(nvm_dir)/nvm.sh" ]] && return
    log "Instalando nvm $NVM_RELEASE..."
    curl -fsSL "$NVM_INSTALL_URL" | PROFILE=/dev/null bash
}

load_nvm() {
    export NVM_DIR
    NVM_DIR="$(nvm_dir)"
    set +u # nvm.sh nao e compativel com `set -u`
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    set -u
}

install_node() {
    load_nvm
    log "Instalando Node ($NODE_VERSION)..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION" >/dev/null
}

ensure_node() {
    if node_is_sufficient; then
        log "Node $(node --version) ok (minimo: v$MIN_NODE_MAJOR)."
        return
    fi
    install_prerequisites
    install_nvm
    install_node
    node_is_sufficient || die "Node insuficiente apos a instalacao (minimo: v$MIN_NODE_MAJOR)."
    log "Node $(node --version) pronto."
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
    ensure_node "$@"
fi
