import net from 'node:net';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_SSH_ENV, NODE_RECOMMENDED_MAJOR } from './config.js';

const SUDO_KEEPALIVE_MS = 50_000;
const TCP_TIMEOUT_MS = 3_000;

/** Escapa um valor para uso em shell (aspas simples). */
export const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** Carrega o nvm e ativa o Node recomendado (se instalado). */
const NVM_PRELUDE = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; '
    + '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
    + `nvm use ${NODE_RECOMMENDED_MAJOR} >/dev/null 2>&1 || true;`;

const defaultTcpOpen = (host, port, timeoutMs = TCP_TIMEOUT_MS) => new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
});

const timestamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

/**
 * Contexto compartilhado pelas secoes: dados do ambiente + helpers de execucao.
 * Tudo que toca o sistema passa por `exec` (e `tcpOpen`), entao os testes injetam falsos.
 */
export function createContext({
    home, user, hostname = 'dev', shell = '', exec, platform, nxDir, uid = 1000, env = process.env,
    options = {}, tcpOpen = defaultTcpOpen,
}) {
    let sudoReady = false;
    let keepAlive;

    const capture = async (command, args = [], opts) => {
        try {
            const { output } = await exec(command, args, opts);
            return { ok: true, output: output ?? '', code: 0 };
        } catch (error) {
            return { ok: false, output: error.output ?? error.message ?? '', code: error.code };
        }
    };

    const ctx = {
        home, user, hostname, shell, exec, platform, nxDir, uid, env, options, tcpOpen, capture, timestamp,
        sshKeyDir: join(home, '.ssh'),
        dockerViaSg: false, // true quando o grupo docker ainda nao vale neste terminal (usa `sg docker`)
        showKnownIssues: false,
        readText: (path) => readFile(path, 'utf8').catch(() => ''),
        fileExists: (path) => access(path).then(() => true, () => false),
        has: async (command) => (await capture('sh', ['-c', `command -v ${shellQuote(command)}`])).ok,
        bash: (script, opts) => exec('bash', ['-c', script], opts),
        bashCapture: (script, opts) => capture('bash', ['-c', script], opts),
        /** Executa mostrando a saida em tempo real (correcoes e instalacoes). */
        x: (command, args = [], opts) => exec(command, args, { stream: true, ...opts }),
        gitSsh: { env: GIT_SSH_ENV },
    };

    /** Script de bash com o nvm carregado e o Node recomendado ativo. */
    ctx.nvm = (script, opts) => ctx.bashCapture(`${NVM_PRELUDE} ${script}`, opts);
    ctx.nvmStream = (script, opts) => ctx.bash(`${NVM_PRELUDE} ${script}`, { stream: true, ...opts });

    /** docker; quando o grupo ainda nao vale neste terminal, passa por `sg docker`. */
    ctx.dk = (args, opts) => (ctx.dockerViaSg
        ? capture('sg', ['docker', '-c', ['docker', ...args].map(shellQuote).join(' ')], opts)
        : capture('docker', args, opts));

    /** Executa `nx <args>` com o ambiente do toolkit, em tempo real. */
    ctx.nx = (args, opts) => {
        const inner = `${NVM_PRELUDE} cd ${shellQuote(nxDir)} && export NXTOOLKITBASEPATH=${shellQuote(nxDir)} `
            + `&& export PATH="$PATH:"${shellQuote(nxDir)} && bash ./nx ${args}`;
        const script = ctx.dockerViaSg ? `sg docker -c ${shellQuote(`bash -c ${shellQuote(inner)}`)}` : inner;
        return ctx.bash(script, { stream: true, ...opts });
    };

    /** Garante o sudo (pede a senha uma vez) e o mantem ativo durante a execucao. */
    ctx.ensureSudo = async () => {
        if (options.checkOnly) return false;
        if (sudoReady) return true;
        if (!await ctx.has('sudo')) {
            ctx.ui?.warn('O sudo nao esta instalado.');
            return false;
        }
        if (!(await capture('sudo', ['-n', 'true'])).ok) {
            ctx.ui?.info('O sudo vai pedir a SUA senha do Ubuntu. Ao digitar, nada aparece na tela - e normal.');
            if (!(await capture('sudo', ['-v'], { interactive: true })).ok) return false;
        }
        sudoReady = true;
        keepAlive = setInterval(() => { capture('sudo', ['-n', 'true']); }, SUDO_KEEPALIVE_MS);
        keepAlive.unref();
        return true;
    };

    /** Grava um arquivo de sistema com sudo, fazendo backup do anterior. */
    ctx.writeRootFile = async (path, content) => {
        if (await ctx.fileExists(path)) await ctx.x('sudo', ['cp', '-a', path, `${path}.bak-${timestamp()}`]);
        const dir = await mkdtemp(join(tmpdir(), 'setup-'));
        try {
            const tmp = join(dir, 'file');
            await writeFile(tmp, content);
            await ctx.x('sudo', ['install', '-m', '0644', tmp, path]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    };

    ctx.dispose = () => clearInterval(keepAlive);
    return ctx;
}
