import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import { ALIAS_BLOCK, GIT_SSH_ENV, NX_REPO_SSH, RC_BLOCK } from '../config.js';
import { nxState, primaryRcFile, rcFiles, renderAliasBlock, renderBlock, upsertBlock } from '../rc.js';

const FETCH_TIMEOUT_MS = 40_000;

export function repoItems(ctx) {
    const dir = ctx.nxDir;
    const git = (...args) => ctx.capture('git', ['-C', dir, ...args]);
    const hasRepo = async () => (await ctx.fileExists(join(dir, '.git'))) && (await ctx.fileExists(join(dir, 'nx')));
    const backup = async (file) => {
        if (await ctx.fileExists(file)) await copyFile(file, `${file}.bak-nx-${ctx.timestamp()}`);
    };
    const dirtyCount = async () => {
        const result = await git('status', '--porcelain');
        return result.ok ? result.output.split('\n').filter((line) => line && !line.startsWith('??')).length : 0;
    };
    /** true so se a pasta existe e tem conteudo (o erro do `ls` numa pasta inexistente nao conta). */
    const isNonEmptyDir = async () => {
        const result = await ctx.capture('ls', ['-A', dir]);
        return result.ok && result.output.trim() !== '';
    };

    const writeBlocks = async (render, markers, label) => {
        for (const file of await rcFiles(ctx)) {
            const content = await ctx.readText(file);
            if (label === 'nx' && content.includes('NXTOOLKITBASEPATH=') && !content.includes(RC_BLOCK.start)) {
                ctx.ui.info(`${basename(file)} ja define NXTOOLKITBASEPATH; deixei como esta (confira se aponta para ${dir}).`);
                continue;
            }
            if (content.includes(markers.start) && label === 'aliases') continue;
            await backup(file);
            await writeFile(file, upsertBlock(content, render(dir), markers));
            ctx.ui.success(`${basename(file)}: bloco do ${label} gravado`);
        }
    };

    return {
        cloned: {
            label: 'Repositorio nx-suite-docker clonado',
            fixDesc: 'git clone via SSH',
            check: async () => {
                if (await hasRepo()) {
                    const branch = (await git('branch', '--show-current')).output.trim();
                    const last = (await git('log', '-1', '--format=%h %ad', '--date=short')).output.trim();
                    return pass(`${dir} · branch ${branch || '?'} · ${last}`);
                }
                return fail((await isNonEmptyDir()) ? `${dir} existe mas nao e o repositorio nx-suite-docker` : `repositorio nao clonado em ${dir}`);
            },
            fix: async () => {
                if (ctx.options.skipRepos) {
                    ctx.ui.info('--skip-repos: nao vou clonar.');
                    return false;
                }
                if (await isNonEmptyDir()) {
                    ctx.ui.warn(`A pasta ${dir} nao esta vazia; nao vou sobrescrever.`);
                    return false;
                }
                await mkdir(dirname(dir), { recursive: true });
                await ctx.x('git', ['clone', NX_REPO_SSH, dir], { env: GIT_SSH_ENV });
                return true;
            },
            guide: () => [
                'Clone manualmente (precisa da chave SSH cadastrada - PASSO 4):',
                `  git clone ${NX_REPO_SSH} ${dir}`,
                'Se a pasta existir com outro conteudo, renomeie/apague (ou use --dir OUTRA_PASTA).',
            ],
        },
        updated: {
            label: 'Repositorio atualizado',
            level: 'optional',
            fixDesc: 'git pull --ff-only',
            check: async () => {
                const fetched = await ctx.capture('git', ['-C', dir, 'fetch', '--quiet'], { timeoutMs: FETCH_TIMEOUT_MS });
                if (!fetched.ok) return pass('nao consegui consultar o remoto (sem rede?)');
                const behind = Number((await git('rev-list', '--count', 'HEAD..@{u}')).output.trim()) || 0;
                if (behind === 0) return pass('em dia com o remoto');
                const dirty = await dirtyCount();
                return fail(`${behind} commit(s) novo(s) no remoto${dirty ? ` · ${dirty} arquivo(s) modificado(s) localmente` : ''}`);
            },
            fix: async () => {
                if (await dirtyCount()) {
                    ctx.ui.warn('Ha alteracoes locais nao commitadas; nao vou atualizar sozinho.');
                    return false;
                }
                await ctx.x('git', ['-C', dir, 'pull', '--ff-only']);
                return true;
            },
            guide: () => [`  cd ${dir} && git pull`],
        },
        ownership: {
            label: 'Dono dos arquivos do toolkit',
            fixDesc: 'sudo chown -R',
            check: async () => {
                const result = await ctx.capture('find', [dir, '!', '-user', ctx.user, '-print', '-quit']);
                return result.ok && result.output.trim() === '' ? pass(`tudo pertence a ${ctx.user}`) : fail('ha arquivos de outro dono (ex.: criados por containers ou root)');
            },
            fix: async () => {
                if (!await ctx.ensureSudo()) return false;
                await ctx.x('sudo', ['chown', '-R', `${ctx.user}:${ctx.user}`, dir]);
                return true;
            },
            guide: () => [`  sudo chown -R ${ctx.user}:${ctx.user} ${dir}`],
        },
        executable: {
            label: 'Comando nx executavel',
            fixDesc: 'chmod +x',
            check: async () => ((await ctx.capture('test', ['-x', join(dir, 'nx')])).ok ? pass(`${dir}/nx executavel`) : fail(`o arquivo ${dir}/nx nao esta executavel`)),
            fix: async () => (await ctx.capture('chmod', ['+x', join(dir, 'nx')])).ok,
            guide: () => [`  chmod +x ${dir}/nx`],
        },
        shell: {
            label: 'NXTOOLKITBASEPATH e PATH no shell',
            fixDesc: 'gravar no arquivo de configuracao do seu shell',
            check: async () => {
                const primary = await primaryRcFile(ctx);
                const files = new Set([...(await rcFiles(ctx)), ...(ctx.shell.endsWith('zsh') ? [join(ctx.home, '.zshrc')] : [])]);
                const states = await Promise.all([...files].map(async (file) => nxState(await ctx.readText(file), dir, ctx.home)));
                if (states.some((state) => state.kind === 'ok')) return pass(`${basename(primary)} configurado`);
                const other = states.find((state) => state.kind === 'other');
                return fail(other ? `${basename(primary)} aponta para "${other.value}" e nao para ${dir}` : `${basename(primary)} (seu shell de login) nao define NXTOOLKITBASEPATH`);
            },
            fix: () => writeBlocks(renderBlock, RC_BLOCK, 'nx'),
            guide: () => [
                'Adicione ao final do ~/.bashrc (e do ~/.zshrc, se usar zsh):',
                `  export NXTOOLKITBASEPATH="${dir}"`,
                '  export PATH="$PATH:$NXTOOLKITBASEPATH"',
                'Depois abra um terminal novo (ou rode:  source ~/.bashrc ).',
            ],
        },
        aliases: {
            label: 'Aliases de navegacao (cdww, cdfb, cdfn)',
            level: 'personal',
            fixDesc: 'gravar no arquivo do seu shell',
            check: async () => {
                const content = await ctx.readText(await primaryRcFile(ctx));
                return content.includes(ALIAS_BLOCK.start) || content.includes('alias cdww=')
                    ? pass('aliases presentes')
                    : fail('atalhos de navegacao (cdww, cdfb, cdfn) nao configurados');
            },
            fix: () => writeBlocks(renderAliasBlock, ALIAS_BLOCK, 'aliases'),
            guide: () => [`Aliases sao pessoais: so se quiser. Exemplo:  alias cdww="cd ${dir}/"  (e cdfb, cdfn para os projetos em sources/).`],
        },
    };
}

export const repoSection = {
    title: "Repositorio nx-suite-docker e comando 'nx' no PATH",
    why: [
        'O nx-suite-docker contem o comando "nx" (o toolkit). Ele e clonado por SSH na pasta escolhida.',
        'Para rodar "nx" de qualquer pasta e preciso a variavel NXTOOLKITBASEPATH e a pasta no PATH (gravadas no arquivo do seu shell).',
    ],
    run: async (runner) => {
        const { ctx } = runner;
        const items = repoItems(ctx);
        if (runner.options.skipRepos && !await ctx.fileExists(join(ctx.nxDir, '.git'))) {
            runner.warn('--skip-repos: pulei o clone');
            runner.record('skip', 'Repositorio nx-suite-docker', '--skip-repos');
            return;
        }
        if (!await runner.ensure(items.cloned)) return;
        await runner.ensure(items.updated);
        await runner.ensure(items.ownership);
        await runner.ensure(items.executable);
        await runner.ensure(items.shell);
        await runner.ensure(items.aliases);
    },
};
