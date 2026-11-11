import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, runPipeline } from '../../common/tui/src/index.js';
import { createSteps } from './steps.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const USAGE = 'Uso: install.sh [--no-chsh] [--help]';

function parseArgs(args) {
    if (args.includes('-h') || args.includes('--help')) return { help: true };
    const unknown = args.filter((arg) => arg !== '--no-chsh');
    if (unknown.length) return { error: `Argumento desconhecido: ${unknown[0]}` };
    return { changeShell: !args.includes('--no-chsh') };
}

async function main(args) {
    const options = parseArgs(args);
    if (options.help) return console.log(USAGE);
    if (options.error) {
        console.error(`${options.error}\n${USAGE}`);
        process.exitCode = 2;
        return;
    }

    const steps = createSteps({
        home: homedir(),
        templatesDir: TEMPLATES_DIR,
        exec: run,
        currentShell: process.env.SHELL,
        changeShell: options.changeShell,
    });
    const { ok } = await runPipeline({ title: 'Setup do terminal (zsh)', steps });
    if (!ok) process.exitCode = 1;
}

await main(process.argv.slice(2));
