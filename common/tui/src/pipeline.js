import { ui as defaultUi } from './ui.js';

const ERROR_OUTPUT_LINES = 15;

/**
 * @typedef {object} Step
 * @property {string} title
 * @property {(context: object) => Promise<void>} run
 * @property {(context: object) => Promise<boolean>} [skip]  true = pular a etapa
 * @property {boolean} [interactive]  true = sem spinner (a etapa usa o terminal, ex.: sudo)
 * @property {boolean} [optional]  true = se falhar, avisa e segue para a proxima etapa
 */

const tailLines = (text = '', count = ERROR_OUTPUT_LINES) => text.trim().split('\n').slice(-count).join('\n');

async function runStep(step, context, ui) {
    if (step.skip && await step.skip(context)) {
        ui.info(`${step.title} (ja concluido, pulando)`);
        return;
    }

    if (step.interactive) {
        ui.step(step.title);
        await step.run(context);
        ui.success(step.title);
        return;
    }

    const spinner = ui.spinner();
    spinner.start(step.title);
    try {
        await step.run(context);
        spinner.stop(step.title);
    } catch (error) {
        spinner.error(`${step.title} falhou`);
        throw error;
    }
}

/**
 * Executa as etapas em ordem; para na primeira falha.
 * @param {{ title: string, steps: Step[], context?: object }} pipeline
 * @param {object} [ui] interface injetavel
 * @returns {Promise<{ ok: boolean, failedStep?: string }>}
 */
export async function runPipeline({ title, steps, context = {} }, ui = defaultUi) {
    ui.intro(title);
    for (const step of steps) {
        try {
            await runStep(step, context, ui);
        } catch (error) {
            if (step.optional) {
                ui.warn(`${step.title}: ${tailLines(error.output) || error.message} (etapa opcional, seguindo)`);
                continue;
            }
            ui.error(tailLines(error.output) || error.message);
            ui.outro(`Pipeline interrompida em: ${step.title}`);
            return { ok: false, failedStep: step.title };
        }
    }
    ui.outro('Tudo pronto.');
    return { ok: true };
}
