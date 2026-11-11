import { fail, pass } from '../../../common/tui/src/index.js';
import { APT_PACKAGES } from '../config.js';

const APT_INSTALL = ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y'];

export function pacotesItem(ctx) {
    let missing = [];

    return {
        label: 'Pacotes base instalados',
        fixDesc: 'apt-get install dos pacotes que faltam',
        check: async () => {
            const states = await Promise.all(APT_PACKAGES.map(async (name) => [name, (await ctx.capture('dpkg', ['-s', name])).ok]));
            missing = states.filter(([, installed]) => !installed).map(([name]) => name);
            return missing.length === 0
                ? pass(`${APT_PACKAGES.length} pacotes presentes (git, curl, unzip, jq, gcc/make, psql, redis-cli...)`)
                : fail(`faltam: ${missing.join(' ')}`);
        },
        fix: async () => {
            if (!await ctx.ensureSudo()) return false;
            await ctx.x('sudo', ['apt-get', 'update']);
            try {
                await ctx.x('sudo', [...APT_INSTALL, ...missing]);
            } catch {
                ctx.ui.info('Instalacao em lote falhou; tentando um por um para isolar o problema...');
                for (const name of missing) {
                    await ctx.x('sudo', [...APT_INSTALL, name]).catch(() => ctx.ui.warn(`nao consegui instalar ${name}`));
                }
            }
        },
        guide: () => ['Instale manualmente:', `  sudo apt-get update && sudo apt-get install -y ${missing.join(' ')}`],
    };
}

export const pacotesSection = {
    title: 'Pacotes basicos do sistema (apt)',
    why: [
        'Ferramentas que o toolkit e os projetos usam por baixo dos panos:',
        '  git/openssh-client (repositorios) · curl/wget · unzip/zip · jq (JSON nos scripts) · openssl',
        '  build-essential/python3/pkg-config (compilar modulos nativos do Node, ex.: ssh2)',
        '  postgresql-client (psql) · redis-tools (redis-cli) · netcat (teste de portas)',
    ],
    run: (runner) => runner.ensure(pacotesItem(runner.ctx)),
};
