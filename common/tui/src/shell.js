import { spawn } from 'node:child_process';

const MAX_OUTPUT_CHARS = 20_000;

export class CommandError extends Error {
    constructor(command, code, output) {
        super(`Comando falhou (codigo ${code}): ${command}`);
        this.name = 'CommandError';
        this.command = command;
        this.code = code;
        this.output = output;
    }
}

const keepTail = (text) => text.slice(-MAX_OUTPUT_CHARS);

/**
 * Executa um comando.
 * - Padrao: captura stdout/stderr (para a TUI mostrar so em caso de erro).
 * - `interactive: true`: herda o terminal (necessario para `sudo`, `chsh`, etc.).
 * Rejeita com CommandError se o codigo de saida for diferente de zero.
 */
export function run(command, args = [], { interactive = false, cwd, env } = {}) {
    return new Promise((resolve, reject) => {
        const label = [command, ...args].join(' ');
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        const collect = (chunk) => { output = keepTail(output + chunk); };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);

        child.on('error', (error) => reject(new CommandError(label, 'spawn', error.message)));
        child.on('close', (code) => {
            if (code === 0) return resolve({ output });
            reject(new CommandError(label, code, output));
        });
    });
}
