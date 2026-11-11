export const USAGE = `Uso: install.sh [opcoes]

  --check           Apenas verifica e mostra o resumo. Nao instala nem altera nada.
  -y, --yes         Aceita automaticamente as correcoes seguras (os passos manuais continuam esperando voce).
  --dir CAMINHO     Onde clonar/encontrar o nx-suite-docker (padrao: ~/snx/nx-suite-docker).
  --skip-repos      Nao clona nada (nem o nx-suite-docker nem os repositorios opcionais).
  --skip-setup      Nao executa o setup do ambiente (containers, banco, hosts).
  --with-optional   Instala tambem as ferramentas opcionais sem perguntar.
  --log ARQUIVO     Grava o resumo em ARQUIVO.
  --no-color        Desliga as cores.
  --version         Mostra a versao.
  -h, --help        Mostra esta ajuda.

Codigos de saida: 0 = tudo obrigatorio ok | 1 = ha pendencias | 2 = voce saiu`;

const FLAGS = {
    '--check': 'checkOnly',
    '-y': 'assumeYes',
    '--yes': 'assumeYes',
    '--skip-repos': 'skipRepos',
    '--skip-setup': 'skipSetup',
    '--with-optional': 'withOptional',
    '--no-color': 'noColor',
};

/** Interpreta os argumentos. Retorna `{ help }`, `{ version }`, `{ error }` ou `{ options, dir, log }`. */
export function parseArgs(argv) {
    const options = {
        checkOnly: false, assumeYes: false, skipRepos: false, skipSetup: false, withOptional: false, noColor: false,
    };
    let dir;
    let log;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '-h' || arg === '--help') return { help: true };
        if (arg === '--version') return { version: true };
        if (arg in FLAGS) options[FLAGS[arg]] = true;
        else if (arg === '--dir' || arg === '--log') {
            const value = argv[index + 1];
            if (!value || value.startsWith('-')) return { error: `${arg} exige um valor.` };
            if (arg === '--dir') dir = value;
            else log = value;
            index += 1;
        } else return { error: `Opcao desconhecida: ${arg}` };
    }
    return { options, dir, log };
}
