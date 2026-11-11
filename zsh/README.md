# zsh

Pipeline do terminal: zsh, oh-my-zsh, tema Spaceship (cores Vesper) e os plugins
`git`, `zsh-autosuggestions` e `zsh-syntax-highlighting`.

Alvo: Ubuntu/Debian (apt). Idempotente: cada etapa pula o que ja esta feito.

## Uso

```bash
./install.sh              # instala e define o zsh como shell padrao
./install.sh --no-chsh    # instala sem trocar o shell
./install.sh --help
```

O `install.sh` garante o Node (`common/bootstrap/ensure-node.sh`) e delega para a pipeline em Node,
que usa a TUI de `common/tui`. Depois, abra um novo terminal. Os icones do prompt exigem uma
Nerd Font (no WSL, instale e selecione a fonte no Windows Terminal).

## Etapas

| # | Etapa | Pula quando | Observacao |
|---|---|---|---|
| 1 | Pacotes (git, curl, zsh, bat) | todos instalados | `sudo`, interativa |
| 2 | Pacotes opcionais (eza) | instalado | se falhar, avisa e segue |
| 3 | oh-my-zsh | `~/.oh-my-zsh` existe | |
| 4 | Plugins e tema | nunca | clona ou faz `git pull --ff-only` |
| 5 | Link do tema | nunca | recria o link |
| 6 | `~/.zshrc` | nunca | backup `~/.zshrc.backup.<data>` antes de escrever |
| 7 | `~/.zshrc.local` | arquivo existe | nunca sobrescrito |
| 8 | Shell padrao | `--no-chsh` ou ja e zsh | `chsh`, interativa |
| 9 | Verificacao | nunca | abre o zsh e confere o tema |

Node e nvm nao sao instalados aqui: o bootstrap ja os garante antes da pipeline.

## Estrutura

```
zsh/
├── install.sh          entrada (bash): ensure-node + delega ao Node
├── src/
│   ├── config.js       pacotes, repositorios, glifos
│   ├── render.js       template -> .zshrc
│   ├── steps.js        as etapas (dependencias injetadas)
│   └── main.js         argumentos e execucao da pipeline
├── templates/
│   ├── zshrc           conteudo do ~/.zshrc (placeholders @GIT_SYMBOL@, @NODE_SYMBOL@)
│   └── zshrc.local     ajustes pessoais; copiado para ~/.zshrc.local se nao existir
└── test/               npm test
```

## Como personalizar

| Quero | Altere |
|---|---|
| Cores, layout ou ordem do prompt | `templates/zshrc` |
| Pacotes do apt | `APT_PACKAGES` / `OPTIONAL_APT_PACKAGES` em `src/config.js` |
| Plugins ou tema | `CUSTOM_REPOS` em `src/config.js` (e `plugins=(...)` no template) |
| Ajustes pessoais para novas maquinas | `templates/zshrc.local` |
| Ajustes so desta maquina | `~/.zshrc.local` (nunca sobrescrito) |

## Testes

```bash
npm test
```

Os testes usam um `HOME` temporario e um executor de comandos falso: nada e instalado de verdade.
