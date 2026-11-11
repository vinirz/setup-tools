import * as clack from '@clack/prompts';
import pc from 'picocolors';

const CANCELLED_EXIT_CODE = 130;

function unwrap(value) {
    if (clack.isCancel(value)) {
        clack.cancel('Operacao cancelada.');
        process.exit(CANCELLED_EXIT_CODE);
    }
    return value;
}

/** Interface padrao da TUI. Pipelines recebem esta interface por injecao (facilita testes). */
export const ui = {
    intro: (title) => clack.intro(pc.inverse(` ${title} `)),
    outro: (message) => clack.outro(message),
    info: (message) => clack.log.info(message),
    success: (message) => clack.log.success(message),
    warn: (message) => clack.log.warn(message),
    error: (message) => clack.log.error(message),
    step: (message) => clack.log.step(message),
    spinner: () => clack.spinner(),
    confirm: async (message, initialValue = true) => unwrap(await clack.confirm({ message, initialValue })),
    select: async (message, options) => unwrap(await clack.select({ message, options })),
    multiselect: async (message, options) => unwrap(await clack.multiselect({ message, options, required: false })),
};
