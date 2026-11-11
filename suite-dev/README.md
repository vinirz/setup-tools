# suite-dev

Pipeline do ambiente de desenvolvimento do NX Suite (WSL2 + Ubuntu, ou Ubuntu nativo). Baseada no
`setup-ambiente.sh` do `nx-suite-docker`, com a TUI de `common/tui`. Cada item segue o padrao
**verifica -> corrige (com confirmacao) -> orienta e espera**, e pode ser repetida quantas vezes quiser:
so mexe no que ainda falta.

## Uso

```bash
./install.sh                 # verifica e corrige
./install.sh --check         # so diagnostica: nao instala nem altera nada, nao pede sudo
./install.sh -y              # aceita as correcoes seguras sem perguntar
./install.sh --help
```

| Opcao | Efeito |
|---|---|
| `--check` | Apenas verifica e mostra o resumo (grava so o log) |
| `-y`, `--yes` | Aceita as correcoes seguras. Passos manuais (ex.: cadastrar a chave SSH) continuam esperando voce |
| `--dir CAMINHO` | Onde clonar/encontrar o nx-suite-docker (padrao: `~/snx/nx-suite-docker`; pergunta se nao existir) |
| `--skip-repos` | Nao clona nada |
| `--skip-setup` | Nao executa o setup do ambiente (containers, banco) |
| `--with-optional` | Instala as ferramentas opcionais sem perguntar |
| `--log ARQUIVO` | Onde gravar o resumo (padrao: `~/nx-setup-ambiente-<data>.log`) |
| `--no-color` | Sem cores |

Codigos de saida: `0` tudo obrigatorio ok · `1` ha pendencias · `2` voce saiu · `64` opcao invalida.

## Passos

| # | Passo | Itens |
|---|---|---|
| 1 | Ambiente | nao root · WSL2 · Ubuntu · x86_64 · systemd (corrige `/etc/wsl.conf`) · sudo · internet · disco (40 GB) · RAM (8 GB) · disco esparso do WSL |
| 2 | Pacotes apt | git, curl, unzip, zip, jq, openssl, build-essential, python3, pkg-config, psql, redis-cli, netcat... |
| 3 | Git | instalado · nome/e-mail · `core.autocrlf=input` |
| 4 | SSH | chave `ed25519` · acesso ao Bitbucket · permissao no repo · GitHub (opcional) |
| 5 | Docker | engine · servico · grupo `docker` · daemon · plugins **compose** e **buildx** · atalho `docker-compose` · `hello-world` |
| 6 | Node | nvm · **Node 24** (ativo e padrao) · pnpm (versao do `packageManager` do fullbackend) · PM2 · yarn |
| 7 | Extras (opcionais) | AWS CLI · credenciais AWS · openvpn · ngrok · mongosh |
| 8 | Repositorio | clone · atualizado · dono dos arquivos (`chown`) · `nx` executavel · `NXTOOLKITBASEPATH` e `PATH` no shell · aliases (pessoais) |
| 9 | Setup | `ENVIROMENT` · **`/etc/wsl.conf` com `[network] generateHosts = false`** · **`nx init-hosts`** · `nx pull-services` · `nx init-services` · imagens **rabbitmq** e **redis** · containers rabbitmq, redis, mongodb, postgres · `nx load-postgres` |
| 10 | Verificacao | projetos · hosts do Windows · `.env` · Postgres (15433) · migrations · repos opcionais |

### Decisoes

- **Node 24 e obrigatorio** (a mesma versao dos Dockerfiles do backend). O padrao do nvm tambem precisa ser 24.
- **Plugins do Docker** (`docker-compose-plugin`, `docker-buildx-plugin`) vem do repositorio oficial. O `docker-compose` v1 do tutorial nao e instalado; um atalho em `~/.local/bin` repassa para o plugin v2.
- **O setup NAO builda todos os containers.** Substitui o `nx setup` sem o `nx build-dockers` (que apaga todos os containers da maquina com `docker rm -f` e faz `docker system prune`). So rabbitmq e redis sao buildados; mongodb e postgres sobem por `docker compose`. Os demais servicos (APIs e workers) rodam pelo PM2: `nx start`.
- **Hosts:** a ordem e `ENVIROMENT` -> `generateHosts=false` no `/etc/wsl.conf` -> `nx init-hosts`. O `init-hosts` le o dominio do `ENVIROMENT` e usa `sudo`. Sem o `generateHosts=false` o WSL recria o `/etc/hosts` a cada reinicio e apaga as entradas `#NXT`. A mudanca do `wsl.conf` vale a partir do proximo `wsl --shutdown`; a mensagem final avisa quando isso for necessario. Com `--check` ou `--skip-setup`, esses dois itens sao verificados no passo 10.
- **O banco so e recarregado se estiver vazio.** O `nx load-postgres` reseta o banco.
- **`ENVIROMENT`** so e criado se nao existir (o `nx setup` original sobrescreve).
- **Grupo `docker` recem-adicionado:** o terminal atual ainda nao o enxerga; a pipeline usa `sg docker` ate abrir um terminal novo.
- **Shell:** o bloco do `nx` vai para `~/.zshrc.local` quando o `~/.zshrc` o carrega (o setup do zsh nao o apaga); senao, `~/.zshrc`. Tambem vai para `~/.bashrc`. Cada arquivo recebe backup `.bak-nx-<data>`. Um `NXTOOLKITBASEPATH` que voce definiu a mao em outro lugar nao e sobrescrito.

## Estrutura

```
suite-dev/
├── install.sh              entrada (bash): garante Node e delega
├── src/
│   ├── main.js, cli.js     argumentos e execucao
│   ├── config.js           constantes (versoes, URLs, containers)
│   ├── context.js          dados do ambiente + helpers (exec, sudo, nvm, docker, nx)
│   ├── sections/           um arquivo por passo; index.js define a ordem
│   └── rc.js, ini.js, wsl.js, parse.js, hints.js, docker-install.js, db.js, platform.js, args.js
└── test/                   npm test (executor falso + HOME temporario)
```

## Testes

```bash
npm test
```

Nada e instalado de verdade: os testes usam um executor de comandos falso e um `HOME` temporario.
