import { readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { exists, formatReport, run, runChecklist, ui as defaultUi } from '../../common/tui/src/index.js';
import { parseArgs, USAGE } from './args.js';
import { DEFAULT_NX_DIR, SCRIPT_VERSION } from './config.js';
import { createContext } from './context.js';
import { detectPlatform } from './platform.js';
import { SECTIONS } from './sections/index.js';

const EXIT_BAD_USAGE = 64;
const NEXT_STEPS = 'Proximo passo: abra um terminal NOVO e rode "nx start" para subir os demais servicos pelo PM2.';
const WSL_RESTART_NOTICE = 'Reinicie o WSL (PowerShell: wsl --shutdown) para o /etc/hosts nao ser recriado.';

const successMessage = (ctx) => `Nenhuma pendencia obrigatoria. ${ctx.wslRestartNeeded ? `${WSL_RESTART_NOTICE} ` : ''}${NEXT_STEPS}`;

const expandHome = (path, home) => resolve(path.startsWith('~') ? join(home, path.slice(1)) : path);

/** Pasta do nx-suite-docker: --dir, a pasta padrao se ja existir, ou pergunta (so em modo interativo). */
export async function chooseNxDir({ dirArg, home, options, ui, pathExists = exists }) {
    const fallback = join(home, DEFAULT_NX_DIR);
    if (dirArg) return expandHome(dirArg, home);
    if (await pathExists(join(fallback, '.git'))) return fallback;
    if (options.checkOnly || options.assumeYes || !ui.interactive) return fallback;
    const answer = (await ui.text('Onde clonar/encontrar o nx-suite-docker?', fallback)).trim();
    return expandHome(answer || fallback, home);
}

async function offerShellRestart(ui, user) {
    if (!await ui.confirm('Reiniciar o shell agora para aplicar as mudancas (PATH, nvm e grupo docker)?', true)) {
        ui.info('Abra um novo terminal para aplicar as mudancas.');
        return;
    }
    await run('sudo', ['-iu', user], { interactive: true }).catch(() => {});
}

async function writeLog(path, report, nxDir) {
    const header = `suite-dev ${SCRIPT_VERSION} · ${new Date().toISOString()} · ${nxDir}\n\n`;
    await writeFile(path, `${header}${formatReport(report)}\n`).catch(() => {});
}

/** Executa a pipeline. Retorna o codigo de saida. */
export async function cli(argv, { ui = defaultUi, exec = run } = {}) {
    const parsed = parseArgs(argv);
    if (parsed.help) { console.log(USAGE); return 0; }
    if (parsed.version) { console.log(`suite-dev ${SCRIPT_VERSION}`); return 0; }
    if (parsed.error) { console.error(`${parsed.error}\n${USAGE}`); return EXIT_BAD_USAGE; }

    const { options } = parsed;
    const home = homedir();
    const { username } = userInfo();
    const platform = await detectPlatform({ read: (path) => readFile(path, 'utf8') });
    const nxDir = await chooseNxDir({ dirArg: parsed.dir, home, options, ui });
    const interactive = Boolean(ui.interactive);

    const ctx = createContext({
        home, user: username, hostname: hostname(), shell: process.env.SHELL ?? '', exec, platform, nxDir,
        uid: process.getuid?.() ?? 1000, options,
    });

    const { exitCode, report } = await runChecklist({
        title: `Setup do ambiente suite-dev (v${SCRIPT_VERSION})`,
        sections: SECTIONS,
        context: ctx,
        options: { ...options, interactive },
        successMessage,
    }, ui);
    ctx.dispose();

    await writeLog(parsed.log ?? join(home, `nx-setup-ambiente-${ctx.timestamp()}.log`), report, nxDir);
    if (exitCode === 0 && !options.checkOnly && interactive) await offerShellRestart(ui, username);
    return exitCode;
}
