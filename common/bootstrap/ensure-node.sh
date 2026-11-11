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

# Major do Node, ou 0 se o node nao existir ou nao executar (ex.: falta de biblioteca).
node_major() {
    local version
    version="$(node --version 2>/dev/null)" || { echo 0; return; }
    [[ $version =~ ^v([0-9]+) ]] && echo "${BASH_REMATCH[1]}" || echo 0
}

node_is_sufficient() { (( $(node_major) >= MIN_NODE_MAJOR )); }

# Pacotes apt dos pre-requisitos que faltam (um por linha).
missing_prerequisites() {
    command -v curl >/dev/null || echo curl
    command -v git  >/dev/null || echo git
    command -v xz   >/dev/null || echo xz-utils
    # Os binarios oficiais do Node precisam de libatomic.so.1.
    ldconfig -p 2>/dev/null | grep -q 'libatomic\.so\.1' || echo libatomic1
}

install_prerequisites() {
    local -a missing
    mapfile -t missing < <(missing_prerequisites)
    (( ${#missing[@]} )) || return 0
    command -v apt-get >/dev/null || die "Instale manualmente: ${missing[*]} (apt nao encontrado)."
    log "Instalando pre-requisitos: ${missing[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${missing[@]}"
}

install_nvm() {
    [[ -s "$(nvm_dir)/nvm.sh" ]] && return
    log "Instalando nvm $NVM_RELEASE..."
    local output
    # PROFILE=/dev/null: o ~/.zshrc do template ja carrega o nvm.
    output="$(curl -fsSL "$NVM_INSTALL_URL" | PROFILE=/dev/null bash 2>&1)" \
        || { printf '%s\n' "$output" >&2; die 'Falha ao instalar o nvm.'; }
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
    node_is_sufficient || die "Node indisponivel apos a instalacao (minimo: v$MIN_NODE_MAJOR). Rode: node --version"
    log "Node $(node --version) pronto."
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
    ensure_node "$@"
fi
