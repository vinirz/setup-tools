import { hostname, homedir, userInfo } from 'node:os';
import { run, runPipeline, ui } from '../../common/tui/src/index.js';
import { createSteps } from './steps.js';

const USAGE = 'Uso: install.sh [--help]\nVariavel opcional: SUITE_PARENT_DIR (pasta onde o repositorio sera clonado, sem perguntar).';

/** Shell de login novo: o `sudo -i` relê os grupos (o grupo docker so vale em uma nova sessao). */
const restartCommand = (user) => ['sudo', ['-iu', user]];

async function offerShellRestart(user) {
    if (!await ui.confirm('Reiniciar o shell agora para aplicar as mudancas (PATH e grupo docker)?')) {
        ui.info('Abra um novo terminal para aplicar as mudancas.');
        return;
    }
    const [command, args] = restartCommand(user);
    await run(command, args, { interactive: true }).catch(() => {});
}

async function main(args) {
    if (args.includes('-h') || args.includes('--help')) return console.log(USAGE);
    if (args.length) {
        console.error(`Argumento desconhecido: ${args[0]}\n${USAGE}`);
        process.exitCode = 2;
        return;
    }

    const { username } = userInfo();
    const steps = createSteps({
        home: homedir(),
        user: username,
        hostname: hostname(),
        shell: process.env.SHELL,
        exec: run,
        parentDir: process.env.SUITE_PARENT_DIR,
    });

    const { ok } = await runPipeline({ title: 'Setup do ambiente suite-dev', steps, successMessage: 'Ambiente suite-dev configurado.' });
    if (!ok) {
        process.exitCode = 1;
        return;
    }
    await offerShellRestart(username);
}

await main(process.argv.slice(2));
