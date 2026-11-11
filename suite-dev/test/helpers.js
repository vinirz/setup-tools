import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../src/context.js';

const PLATFORM = { isWsl: true, wslVersion: 2, arch: 'x86_64', osId: 'ubuntu', osLike: 'debian', codename: 'noble', prettyName: 'Ubuntu 24.04' };

/** Erro como o do executor real: com `output` e `code`. */
export const commandError = (output = 'falhou', code = 1) => Object.assign(new Error(output), { output, code });

/** UI falsa: registra eventos e responde `text`/`confirm` em fila. */
export function fakeUi({ texts = [], confirms = [], interactive = true } = {}) {
    const events = [];
    const textQueue = [...texts];
    const confirmQueue = [...confirms];
    const log = (name) => (message) => events.push(`${name}:${message}`);
    return {
        events, interactive,
        info: log('info'), warn: log('warn'), error: log('error'), success: log('success'), step: log('step'),
        note: (message, title) => events.push(`note:${title}:${message}`),
        guide: (lines) => events.push(`guide:${lines.join('|')}`),
        text: async (message, initial = '') => { events.push(`text:${message}`); return textQueue.shift() ?? initial; },
        confirm: async (message) => { events.push(`confirm:${message}`); return confirmQueue.shift() ?? false; },
    };
}

/**
 * Contexto com executor falso. `handler(comando, args, opcoes)` devolve a saida ou lanca (commandError).
 * Retorna `{ ctx, calls, ui, home }`; os comandos executados ficam em `calls`.
 */
export async function makeCtx({ handler = () => '', ui = fakeUi(), platform = {}, shell = '/usr/bin/zsh', options = {}, tcpOpen, env = {}, uid = 1000 } = {}) {
    const home = await mkdtemp(join(tmpdir(), 'suite-home-'));
    const calls = [];
    const exec = async (command, args = [], opts = {}) => {
        calls.push({ command, args, opts, line: [command, ...args].join(' ') });
        return { output: (await handler(command, args, opts)) ?? '' };
    };
    const ctx = createContext({
        home, user: 'dev', hostname: 'maquina', shell, exec, uid, env, options, tcpOpen,
        platform: { ...PLATFORM, ...platform }, nxDir: join(home, 'snx', 'nx-suite-docker'),
    });
    ctx.ui = ui;
    return { ctx, calls, ui, home };
}

export const lines = (calls) => calls.map((call) => call.line);
