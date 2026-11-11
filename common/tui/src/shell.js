import { spawn } from 'node:child_process';

const CAPTURED_OUTPUT_CHARS = 20_000;
const STREAMED_OUTPUT_CHARS = 200_000;

export class CommandError extends Error {
    constructor(command, code, output) {
        super(`Comando falhou (codigo ${code}): ${command}`);
        this.name = 'CommandError';
        this.command = command;
        this.code = code;
        this.output = output;
    }
}

const keepTail = (text, limit) => text.slice(-limit);

const forwardToTerminal = (chunk, isError) => (isError ? process.stderr : process.stdout).write(chunk);

/**
 * Executa um comando.
 * - Padrao: captura stdout/stderr (a TUI so os mostra em caso de erro).
 * - `stream: true`: mostra a saida em tempo real E a captura; o stdin e herdado (prompts de sudo, ssh-keygen).
 * - `interactive: true`: herda o terminal por completo (nada e capturado).
 * - `timeoutMs`: encerra o comando e rejeita com codigo 'timeout'.
 * Rejeita com CommandError se o codigo de saida for diferente de zero.
 */
export function run(command, args = [], {
    interactive = false, stream = false, cwd, env, timeoutMs, forward = forwardToTerminal,
} = {}) {
    return new Promise((resolve, reject) => {
        const label = [command, ...args].join(' ');
        const limit = stream ? STREAMED_OUTPUT_CHARS : CAPTURED_OUTPUT_CHARS;
        let stdio = ['ignore', 'pipe', 'pipe'];
        if (interactive) stdio = 'inherit';
        else if (stream) stdio = ['inherit', 'pipe', 'pipe'];

        const child = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio,
            signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        });

        let output = '';
        const collect = (isError) => (chunk) => {
            output = keepTail(output + chunk, limit);
            if (stream) forward(chunk, isError);
        };
        child.stdout?.on('data', collect(false));
        child.stderr?.on('data', collect(true));

        child.on('error', (error) => {
            const code = error.name === 'AbortError' || error.code === 'ABORT_ERR' ? 'timeout' : 'spawn';
            reject(new CommandError(label, code, output || error.message));
        });
        child.on('close', (code) => {
            if (code === 0) return resolve({ output });
            reject(new CommandError(label, code, output));
        });
    });
}
