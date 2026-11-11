import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import {
    ENV_EXPECTED, HOSTS_MARKER, KNOWN_MIGRATION_ISSUES, OPTIONAL_REPOS, POSTGRES, REQUIRED_SOURCES, WINDOWS_HOSTS_FILE,
} from '../config.js';
import { appliedMigrations } from '../db.js';
import { hostsItems } from './hosts.js';

const OPTIONAL_CLONE_TIMEOUT_MS = 120_000;

export function posItems(ctx) {
    const dir = ctx.nxDir;
    const sources = (...parts) => join(dir, 'sources', ...parts);
    const nxHostLines = async () => (await ctx.readText('/etc/hosts')).split('\n').filter((line) => line.includes(HOSTS_MARKER));

    const missingEnvFiles = async () => {
        const missing = [];
        for (const { dir: project, file } of ENV_EXPECTED) {
            if (await ctx.fileExists(sources(project)) && !await ctx.fileExists(sources(project, file))) missing.push(`${project}/${file}`);
        }
        if (await ctx.fileExists(sources('nx-suite-fullbackend')) && !await ctx.fileExists(sources('nx-suite-fullbackend', '.env'))) {
            missing.push('nx-suite-fullbackend/.env (criado pelo nx load-postgres)');
        }
        return missing;
    };

    const windowsHostsGuide = async () => {
        if (ctx.options.checkOnly) {
            return [
                'As entradas #NXT do /etc/hosts precisam ser copiadas para C:\\Windows\\System32\\drivers\\etc\\hosts (como Administrador).',
                'Rode a pipeline sem --check para eu gerar o arquivo com as linhas prontas.',
            ];
        }
        const lines = await nxHostLines();
        if (lines.length === 0) return ['Rode primeiro:  nx init-hosts   (gera as entradas no /etc/hosts) e depois a pipeline de novo.'];
        const out = join(ctx.home, 'nx-hosts-windows.txt');
        await writeFile(out, `${lines.join('\n')}\n`);
        return [
            `Gerei as linhas em: ${out}   (${lines.length} linhas)`,
            'Opcao A - PowerShell como ADMINISTRADOR do Windows (uma linha):',
            `  Get-Content \\\\wsl$\\${ctx.env.WSL_DISTRO_NAME ?? 'Ubuntu'}\\home\\${ctx.user}\\nx-hosts-windows.txt | Add-Content C:\\Windows\\System32\\drivers\\etc\\hosts`,
            'Opcao B - Bloco de Notas como Administrador: abra C:\\Windows\\System32\\drivers\\etc\\hosts, cole o conteudo do arquivo acima no final e salve.',
        ];
    };

    return {
        enviroment: {
            label: 'Arquivo ENVIROMENT',
            check: async () => ((await ctx.fileExists(join(dir, 'ENVIROMENT'))) ? pass(join(dir, 'ENVIROMENT')) : fail('arquivo ENVIROMENT nao existe (o setup cria a partir do ENVIROMENT.example)')),
            guide: () => [`  cp ${dir}/ENVIROMENT.example ${dir}/ENVIROMENT`],
        },
        sources: {
            label: 'Projetos em sources/ clonados',
            check: async () => {
                const missing = [];
                for (const name of REQUIRED_SOURCES) {
                    if (!await ctx.fileExists(sources(name, '.git'))) missing.push(name);
                }
                return missing.length === 0 ? pass(`${REQUIRED_SOURCES.length} projetos clonados em sources/`) : fail(`nao clonados: ${missing.join(' ')}`);
            },
            guide: () => ['Rode:  nx pull-services   (clona/atualiza os projetos) - precisa do SSH do Bitbucket ok.'],
        },
        hostsWindows: {
            label: 'Hosts no Windows (navegador)',
            level: 'optional',
            check: async () => {
                if (!ctx.platform.isWsl) return pass('nao e WSL');
                const text = await ctx.readText(WINDOWS_HOSTS_FILE);
                if (!text) return pass('nao consegui ler o hosts do Windows (interop desativado)');
                return /pg-local\.|nx-suite-front-novo\.|#NXT/.test(text)
                    ? pass('hosts do Windows tem as entradas do toolkit')
                    : fail('o hosts do WINDOWS nao tem as entradas do toolkit (o navegador do Windows nao vai achar nx-suite-*.smartnx.io)');
            },
            guide: windowsHostsGuide,
        },
        envFiles: {
            label: 'Arquivos .env dos projetos',
            level: 'optional',
            check: async () => {
                const missing = await missingEnvFiles();
                return missing.length === 0 ? pass('arquivos .env esperados presentes') : fail(`faltam: ${missing.join(', ')}`);
            },
            guide: () => [
                'Os arquivos .env contem senhas/chaves e NAO ficam no git. Peca ao time (canal de segredos/cofre) e copie para a pasta de cada projeto.',
                'O do fullbackend e criado por: nx load-postgres (copia .env-local -> .env).',
                'Nunca commite arquivos .env.',
            ],
        },
        postgres: {
            label: `Postgres de pe (porta ${POSTGRES.port})`,
            check: async () => ((await ctx.tcpOpen('127.0.0.1', POSTGRES.port))
                ? pass(`Postgres respondendo em localhost:${POSTGRES.port}`)
                : fail(`nada respondendo em localhost:${POSTGRES.port} (container ${POSTGRES.container} parado?)`)),
            guide: () => ['  nx start postgres', `Veja o motivo:  docker ps -a   e   docker logs --tail 30 ${POSTGRES.container}`],
        },
        migrations: {
            label: 'Migrations do banco principal',
            level: 'optional',
            check: async () => {
                const folder = sources('nx-suite-fullbackend', 'migrations', 'main');
                if (!await ctx.fileExists(folder)) return pass('fullbackend nao clonado (nao verifiquei)');
                const files = (await readdir(folder)).length;
                const applied = await appliedMigrations(ctx);
                if (applied === null) return fail('nao consegui consultar a tabela pgmigrations (banco vazio ou container parado)');
                if (applied >= files) return pass(`${applied} de ${files} migrations do banco principal aplicadas`);
                ctx.showKnownIssues = true;
                return fail(`apenas ${applied} de ${files} migrations aplicadas`);
            },
            guide: () => ['Depois de resolver o motivo, rode:  nx migrations up'],
        },
    };
}

async function offerOptionalRepos(runner) {
    const { ctx } = runner;
    const options = runner.options;
    if (options.skipRepos || options.checkOnly || !await ctx.fileExists(ctx.nxDir)) return;

    const todo = [];
    for (const repo of OPTIONAL_REPOS) {
        if (!await ctx.fileExists(join(ctx.nxDir, 'sources', repo.folder, '.git'))) todo.push(repo);
    }
    if (todo.length === 0) return;

    ctx.ui.info(`Repositorios opcionais ainda nao clonados (nao sao necessarios para o setup):\n${todo.map((repo) => `  - ${repo.folder} (${repo.desc})`).join('\n')}`);
    if (!await runner.confirm('Clonar os opcionais agora (quem nao tiver acesso sera apenas ignorado)?', false)) return;

    await mkdir(join(ctx.nxDir, 'sources'), { recursive: true });
    for (const repo of todo) {
        const result = await ctx.capture('git', ['clone', `git@${repo.host}:${repo.path}.git`, join(ctx.nxDir, 'sources', repo.folder)], { timeoutMs: OPTIONAL_CLONE_TIMEOUT_MS });
        if (result.ok) {
            ctx.ui.success(`clonado: ${repo.folder}`);
            runner.record('ok', `Repositorio opcional ${repo.folder}`);
        } else {
            ctx.ui.warn(`nao consegui clonar ${repo.folder} (sem acesso ou sem chave no ${repo.host})`);
            runner.record('warn', `Repositorio opcional ${repo.folder}`, 'sem acesso');
        }
    }
}

export const posSection = {
    title: 'Verificacao final do ambiente',
    why: ['Confere o resultado: projetos clonados, hosts (Linux e Windows), arquivos .env, Postgres e migrations.'],
    run: async (runner) => {
        const { ctx } = runner;
        if (!await ctx.fileExists(ctx.nxDir)) {
            runner.info('Repositorio ausente: pulei.');
            return;
        }
        const items = posItems(ctx);
        // ENVIROMENT e hosts ja sao tratados pelo setup; so aparecem aqui quando o setup nao roda.
        const standalone = runner.options.checkOnly || runner.options.skipSetup;
        if (standalone) await runner.ensure(items.enviroment);
        await runner.ensure(items.sources);
        if (standalone) {
            const hosts = hostsItems(ctx);
            await runner.ensure(hosts.generateHosts);
            await runner.ensure(hosts.hostsLinux);
        }
        for (const key of ['hostsWindows', 'envFiles', 'postgres', 'migrations']) await runner.ensure(items[key]);
        await offerOptionalRepos(runner);
        if (ctx.showKnownIssues) ctx.ui.note(KNOWN_MIGRATION_ISSUES.join('\n'), 'Problemas conhecidos das migrations');
    },
};
