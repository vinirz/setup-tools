# setup-pipelines

Pipelines de setup de ambiente, com uma TUI em Node compartilhada.

## Estrutura

```
setup-pipelines/
├── common/                      codigo compartilhado entre as pipelines
│   ├── bootstrap/
│   │   └── ensure-node.sh       bash puro: garante Node (via nvm) antes da TUI
│   └── tui/                     TUI em Node (@clack/prompts)
│       ├── src/                 shell.js, ui.js, pipeline.js, index.js
│       └── test/                npm test
├── zsh/                         pipeline: zsh + oh-my-zsh + spaceship + Node (bash)
├── suite-dev/                   pipeline do ambiente suite-dev (a criar)
└── avuei-dev/                   (futuro)
```

## Principios

1. **Duas camadas.** Bash minimo para chegar ao Node; depois, tudo em Node.
2. **Pipelines independentes.** Cada pasta roda sozinha; nada depende do `zsh/` ter rodado.
3. **Idempotente.** Cada etapa pode ser repetida sem efeito colateral.
4. **`common/` nao conhece ambientes.** Quem define passos e ordem e a pasta de cada pipeline.
5. **Poucas dependencias, com versao fixa** (`@clack/prompts`, `picocolors`).

## Bootstrap

```bash
./common/bootstrap/ensure-node.sh
```

Se o Node for >= 22 (`MIN_NODE_MAJOR`) e executar, nao faz nada. Senao:

1. instala via apt o que faltar: `curl`, `git`, `xz-utils` e `libatomic1` (os binarios do Node precisam dela);
2. instala o nvm `v0.39.5` (saida silenciosa; so aparece se falhar);
3. instala o Node `lts/*` pelo nvm e o define como padrao.

Um Node que existe mas nao executa (biblioteca faltando) conta como ausente. Variaveis:
`MIN_NODE_MAJOR`, `NODE_VERSION`, `NVM_RELEASE`.

## TUI (`common/tui`)

```bash
cd common/tui && npm install && npm test
```

Uma pipeline e uma lista de etapas:

```js
import { runPipeline, run } from '../common/tui/src/index.js';

await runPipeline({
    title: 'suite-dev',
    steps: [
        { title: 'Instalar pacotes', interactive: true, run: () => run('sudo', ['apt-get', 'install', '-y', 'git'], { interactive: true }) },
        { title: 'Clonar o repo', skip: async () => existsSync(dir), run: () => run('git', ['clone', url, dir]) },
    ],
});
```

| Campo da etapa | Efeito |
|---|---|
| `run(context)` | Faz o trabalho. Lance um erro para falhar. |
| `skip(context)` | Retorna `true` para pular (idempotencia). |
| `interactive` | Sem spinner e com o terminal herdado; obrigatorio para `sudo`/`chsh`. |

`run()` captura a saida e so a mostra se o comando falhar. A pipeline para na primeira falha.
A interface (`ui`) e injetavel em `runPipeline(pipeline, ui)`, o que permite testar sem terminal.
