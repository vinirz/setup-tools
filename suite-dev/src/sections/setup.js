import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import { ESSENTIAL_CONTAINERS, REQUIRED_SOURCES } from '../config.js';
import { appliedMigrations, runningContainers } from '../db.js';
import { createNxRun } from '../nx-run.js';
import { hostsItems } from './hosts.js';

/**
 * Equivalente ao `nx setup`, mas SEM buildar todos os containers: so os de infraestrutura
 * (rabbitmq, redis, mongodb, postgres). Os demais servicos rodam pelo PM2 (`nx start`).
 * Cada etapa e verificavel, entao rodar de novo so refaz o que falta.
 */
export function setupItems(ctx) {
    const dir = ctx.nxDir;

    const nxRun = createNxRun(ctx);
    const hosts = hostsItems(ctx);

    const imageItem = ({ name, image, coreFolder }) => ({
        label: `Imagem docker ${image}`,
        fixDesc: `nx build-docker core ${coreFolder}`,
        check: async () => ((await ctx.dk(['image', 'inspect', image])).ok ? pass('imagem buildada') : fail(`imagem ${image} ainda nao buildada`)),
        fix: () => nxRun(`build-docker core ${coreFolder}`),
        guide: () => [`  nx build-docker core ${coreFolder}`],
        name,
    });

    const containerItem = ({ name, container }) => ({
        label: `Container ${container} em execucao`,
        fixDesc: `nx start ${name}`,
        check: async () => ((await runningContainers(ctx)).includes(container) ? pass('em execucao') : fail('container parado ou inexistente')),
        fix: () => nxRun(`start ${name}`),
        guide: () => [`  nx start ${name}`, `Veja o motivo:  docker ps -a   e   docker logs --tail 30 ${container}`],
    });

    return [
        {
            label: 'Arquivo ENVIROMENT',
            check: async () => ((await ctx.fileExists(join(dir, 'ENVIROMENT'))) ? pass(join(dir, 'ENVIROMENT')) : fail('arquivo ENVIROMENT nao existe')),
            fix: () => copyFile(join(dir, 'ENVIROMENT.example'), join(dir, 'ENVIROMENT')),
            fixDesc: 'copiar de ENVIROMENT.example',
            guide: () => [`  cp ${dir}/ENVIROMENT.example ${dir}/ENVIROMENT`],
        },
        // O init-hosts usa o dominio do ENVIROMENT; o wsl.conf vem antes para as entradas sobreviverem ao reinicio.
        hosts.generateHosts,
        hosts.hostsLinux,
        {
            label: 'Projetos em sources/ clonados',
            fixDesc: 'nx pull-services develop',
            check: async () => {
                const missing = [];
                for (const name of REQUIRED_SOURCES) {
                    if (!await ctx.fileExists(join(dir, 'sources', name, '.git'))) missing.push(name);
                }
                return missing.length === 0 ? pass(`${REQUIRED_SOURCES.length} projetos clonados`) : fail(`nao clonados: ${missing.join(' ')}`);
            },
            fix: () => nxRun('pull-services develop'),
            guide: () => ['  nx pull-services develop   (precisa do SSH do Bitbucket ok - PASSO 4)'],
        },
        {
            label: 'Dependencias do front e do webchat',
            fixDesc: 'nx init-services',
            check: async () => {
                const missing = [];
                for (const name of ['nx-suite-front-novo', 'nx-suite-webchat']) {
                    if (!await ctx.fileExists(join(dir, 'sources', name, 'node_modules'))) missing.push(name);
                }
                return missing.length === 0 ? pass('node_modules presentes') : fail(`sem node_modules: ${missing.join(' ')}`);
            },
            fix: () => nxRun('init-services'),
            guide: () => ['  nx init-services'],
        },
        ...ESSENTIAL_CONTAINERS.filter((item) => item.image).map(imageItem),
        ...ESSENTIAL_CONTAINERS.map(containerItem),
        {
            label: 'Banco principal carregado (dump + migrations)',
            fixDesc: 'nx load-postgres (so roda porque o banco esta vazio)',
            check: async () => {
                const applied = await appliedMigrations(ctx);
                return applied > 0 ? pass(`${applied} migrations registradas`) : fail('banco vazio ou inacessivel (tabela pgmigrations sem registros)');
            },
            fix: () => nxRun('load-postgres'),
            guide: () => ['  nx load-postgres', 'Atencao: ele RESETA o banco. A pipeline so o executa quando o banco esta vazio.'],
        },
    ];
}

export const setupSection = {
    title: 'Setup do ambiente (containers de infraestrutura e banco)',
    why: [
        'Substitui o "nx setup" sem buildar todos os containers. Faz, em ordem: ENVIROMENT · hosts (wsl.conf + nx init-hosts) · clone dos projetos (pull-services) ·',
        'dependencias do front e do webchat · build das imagens rabbitmq e redis · sobe rabbitmq, redis, mongodb e postgres ·',
        'carrega o dump e roda as migrations. Os demais servicos (APIs e workers) sobem depois pelo PM2: "nx start".',
    ],
    run: async (runner) => {
        const { ctx } = runner;
        const skip = (reason) => {
            runner.record('skip', 'Setup do ambiente (nx)', reason);
            runner.info(`Setup nao executado: ${reason}`);
        };
        if (runner.options.checkOnly) return skip('--check');
        if (runner.options.skipSetup) return skip('--skip-setup');
        if (!await ctx.fileExists(join(ctx.nxDir, 'nx'))) return skip('repositorio ausente');
        if (runner.hasFailures()) {
            runner.warn('Ainda ha pendencias obrigatorias: resolva-as e rode de novo antes do setup.');
            return skip('pendencias obrigatorias nos passos anteriores');
        }
        ctx.ui.warn('Este passo baixa imagens e sobe containers (demora). Rodar de novo so refaz o que falta; o banco so e recarregado se estiver vazio.');
        if (!await runner.confirm('Executar o setup do ambiente agora?', true)) return skip('voce optou por nao executar');
        for (const item of setupItems(ctx)) await runner.ensure({ ...item, autoConfirm: true });
        return undefined;
    },
};
