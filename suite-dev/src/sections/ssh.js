import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import {
    BITBUCKET_SSH_KEYS_URL, GIT_SSH_ENV, GITHUB_SSH_KEYS_URL, NX_REPO_SSH, NX_REPO_WEB, SSH_KEY_NAMES,
} from '../config.js';
import { firstLine } from '../parse.js';

const SSH_TEST_TIMEOUT_MS = 25_000;
const LS_REMOTE_TIMEOUT_MS = 40_000;
const PRIVATE_KEY_MODES = ['600', '400'];
const SSH_DIR_MODE = 0o700;

export function sshItems(ctx) {
    const keyPath = (name) => join(ctx.sshKeyDir, name);

    const findKey = async () => {
        for (const name of SSH_KEY_NAMES) {
            if (await ctx.fileExists(keyPath(name))) return keyPath(name);
        }
        return '';
    };

    const publicKey = async () => {
        for (const name of SSH_KEY_NAMES) {
            const text = (await ctx.readText(`${keyPath(name)}.pub`)).trim();
            if (text) return text;
        }
        return '';
    };

    const sshTest = (host) => ctx.capture('ssh', [
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-T', `git@${host}`,
    ], { timeoutMs: SSH_TEST_TIMEOUT_MS });

    const publicKeyGuide = async (extra = []) => {
        const key = await publicKey();
        return [
            ...(key ? ['Esta e a sua chave PUBLICA (pode compartilhar; NUNCA compartilhe o arquivo sem .pub):', '', key, ''] : []),
            `Cadastre-a no Bitbucket: ${BITBUCKET_SSH_KEYS_URL}  ->  "Add key"  ->  cole a linha acima.`,
            ...extra,
        ];
    };

    return {
        key: {
            label: 'Chave SSH em ~/.ssh',
            fixDesc: 'gerar uma chave ed25519',
            check: async () => {
                const path = await findKey();
                if (!path) return fail('nenhuma chave SSH encontrada em ~/.ssh');
                let detail = SSH_KEY_NAMES.find((name) => keyPath(name) === path);
                const mode = (await ctx.capture('stat', ['-c', '%a', path])).output.trim();
                if (mode && !PRIVATE_KEY_MODES.includes(mode) && (await ctx.capture('chmod', ['600', path])).ok) {
                    detail += ' · permissao corrigida para 600';
                }
                return pass(detail);
            },
            fix: async () => {
                if (!ctx.ui.interactive) return false;
                await mkdir(ctx.sshKeyDir, { recursive: true, mode: SSH_DIR_MODE });
                let email = (await ctx.capture('git', ['config', '--global', 'user.email'])).output.trim();
                if (!email) email = (await ctx.ui.text('E-mail para identificar a chave:')).trim();
                ctx.ui.info('Vou gerar uma chave ed25519. Quando pedir a "passphrase" voce pode so apertar ENTER (sem senha) ou definir uma.');
                await ctx.exec('ssh-keygen', ['-t', 'ed25519', '-C', email, '-f', keyPath('id_ed25519')], { interactive: true });
                ctx.ui.note((await publicKeyGuide()).join('\n'), 'Chave publica SSH');
            },
            guide: () => [
                'Gere uma chave (ou restaure a sua de um backup em ~/.ssh com "chmod 600"):',
                '  ssh-keygen -t ed25519 -C "seu.email@empresa.com"',
            ],
        },
        bitbucket: {
            label: 'Acesso SSH ao Bitbucket',
            check: async () => {
                const { output } = await sshTest('bitbucket.org');
                if (/authenticated|logged in as/i.test(output)) return pass('autenticado via chave SSH');
                if (/passphrase/i.test(output)) return fail('a chave tem passphrase e nao esta no ssh-agent');
                return fail(firstLine(output, 120) || 'sem resposta do Bitbucket');
            },
            guide: () => publicKeyGuide([
                'Se a sua chave tem passphrase, carregue-a no agente antes:',
                '  eval "$(ssh-agent -s)" && ssh-add',
                'Se aparecer "Permission denied (publickey)", a chave ainda nao foi cadastrada (ou foi colada errada).',
            ]),
        },
        repo: {
            label: 'Permissao no repositorio nx-suite-docker',
            check: async () => {
                const result = await ctx.capture('git', ['ls-remote', '--heads', NX_REPO_SSH], { env: GIT_SSH_ENV, timeoutMs: LS_REMOTE_TIMEOUT_MS });
                const branches = result.output.trim().split('\n').filter(Boolean).length;
                return result.ok && branches > 0
                    ? pass(`${branches} branches visiveis no nx-suite-docker`)
                    : fail(`sem permissao de leitura em devsmartnx/nx-suite-docker (${firstLine(result.output)})`);
            },
            guide: () => [
                'A chave funciona, mas o seu usuario ainda nao tem acesso ao workspace "devsmartnx" no Bitbucket.',
                'Peca ao seu lider/gestor para adicionar voce ao workspace e ao repositorio nx-suite-docker.',
                `Confira em: ${NX_REPO_WEB}`,
            ],
        },
        github: {
            label: 'Acesso SSH ao GitHub',
            level: 'optional',
            check: async () => {
                const { output } = await sshTest('github.com');
                if (/successfully authenticated/i.test(output)) return pass(output.match(/Hi [^!]+/)?.[0] ?? 'autenticado');
                return fail(firstLine(output, 120) || 'sem resposta do GitHub');
            },
            guide: () => [
                'So e necessario para os repositorios opcionais do GitHub.',
                `Cadastre a chave em ${GITHUB_SSH_KEYS_URL} e peca acesso a organizacao "infraestruturasnx".`,
            ],
        },
    };
}

export const sshSection = {
    title: 'Chave SSH e acesso aos repositorios (Bitbucket / GitHub)',
    why: [
        'Todos os repositorios sao clonados por SSH (git@bitbucket.org:devsmartnx/...). Sem uma chave cadastrada no',
        'Bitbucket o setup nao consegue baixar nada. A chave privada (id_ed25519) fica so no seu computador.',
    ],
    run: async (runner) => {
        const items = sshItems(runner.ctx);
        await runner.ensure(items.key);
        await runner.ensure(items.bitbucket);
        await runner.ensure(items.repo);
        await runner.ensure(items.github);
    },
};
