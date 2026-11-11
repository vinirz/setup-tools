import pc from 'picocolors';
import { CommandError } from './shell.js';
import { ui as defaultUi } from './ui.js';

const ERROR_OUTPUT_LINES = 8;

export const EXIT_OK = 0;
export const EXIT_PENDING = 1;
export const EXIT_QUIT = 2;

/** Interrompe o checklist (ex.: e preciso reiniciar o WSL). A runner imprime o resumo e encerra. */
export class Stop extends Error {
    constructor(message, exitCode = EXIT_PENDING) {
        super(message);
        this.name = 'Stop';
        this.exitCode = exitCode;
    }
}

export const pass = (detail = '') => ({ ok: true, detail });
export const fail = (why = '') => ({ ok: false, why });

const tail = (text = '', lines = ERROR_OUTPUT_LINES) => text.trim().split('\n').slice(-lines).join('\n');
const describe = (label, text) => (text ? `${label} — ${text}` : label);

/** Texto puro do resumo (usado na TUI e no arquivo de log). */
export function formatReport(report) {
    const groups = [
        ['Ja estava ok', report.ok], ['Corrigido agora', report.fixed], ['Avisos (opcionais)', report.warn],
        ['Pulado', report.skip], ['Pendencias obrigatorias', report.fail],
    ];
    return groups
        .filter(([, items]) => items.length)
        .map(([title, items]) => `${title} (${items.length})\n${items.map((item) => `  - ${item}`).join('\n')}`)
        .join('\n\n');
}

/**
 * Executa secoes de verificacao no padrao "ensure": verifica -> corrige (com confirmacao) -> orienta e espera.
 *
 * Item: { label, level: 'required'|'optional'|'personal', check(ctx) -> {ok, detail, why},
 *         fix?(ctx), fixDesc?, autoConfirm? (nao pergunta antes de corrigir), guide?(ctx) -> string[] | Promise<string[]> }
 * Secao: { title, why?: string[], run(runner) }
 * Opcoes: { checkOnly, assumeYes, withOptional, interactive }
 * @returns {Promise<{ exitCode: number, report: object, stopped?: string }>}
 */
export async function runChecklist({ title, sections, context = {}, options = {}, successMessage }, ui = defaultUi) {
    const { checkOnly = false, assumeYes = false, withOptional = false } = options;
    const interactive = options.interactive ?? ui.interactive ?? false;
    const report = { ok: [], fixed: [], warn: [], fail: [], skip: [] };
    const ctx = Object.assign(context, { ui });

    const record = (status, label, detail) => report[status].push(describe(label, detail));

    async function confirm(question, defaultYes) {
        if (assumeYes) {
            ui.info(`${question} -> automatico (--yes): ${defaultYes ? 'sim' : 'nao'}`);
            return defaultYes;
        }
        if (!interactive) {
            ui.info(`${question} -> sem terminal interativo: nao alterei nada`);
            return false;
        }
        return ui.confirm(question, defaultYes);
    }

    async function waitRecheck() {
        if (!interactive) {
            ui.info('Sem terminal interativo: pendencia registrada (rode de novo depois).');
            return false;
        }
        const choice = await ui.select('Faca o que foi indicado e escolha:', [
            { value: 'verify', label: 'Ja fiz: verificar de novo' },
            { value: 'skip', label: 'Pular este item' },
            { value: 'quit', label: 'Sair' },
        ]);
        if (choice === 'quit') throw new Stop('Voce saiu antes de concluir.', EXIT_QUIT);
        return choice === 'verify';
    }

    function showMissing(level, label, why) {
        if (level === 'required') ui.error(describe(`FALTA: ${label}`, why));
        else if (level === 'optional') ui.warn(describe(`AVISO: ${label} (opcional)`, why));
        else ui.info(describe(`${label} (pessoal, opcional)`, why));
    }

    function recordFailure(level, label, why, checkOnlyMode) {
        if (level === 'required') record('fail', label, why);
        else if (level === 'personal') record('skip', label, 'pessoal, opcional');
        else record(checkOnlyMode ? 'warn' : 'skip', label, why || 'opcional');
    }

    async function applyFix(item) {
        try {
            const result = await item.fix(ctx);
            if (result === false) ui.warn('A correcao automatica nao terminou com sucesso.');
        } catch (error) {
            if (error instanceof Stop) throw error;
            const detail = error instanceof CommandError ? tail(error.output) || error.message : error.message;
            ui.warn(`A correcao automatica falhou: ${detail}`);
        }
    }

    async function ensure(item) {
        const { label, level = 'required', check, fix, guide, fixDesc } = item;
        let failedOnce = false;
        let autoTried = false;
        for (;;) {
            const result = await check(ctx);
            if (result.ok) {
                if (failedOnce) {
                    ui.success(describe(`CORRIGIDO: ${label}`, result.detail));
                    record('fixed', label, result.detail);
                } else {
                    ui.success(describe(`OK: ${label}`, result.detail));
                    record('ok', label, result.detail);
                }
                return true;
            }
            failedOnce = true;
            showMissing(level, label, result.why);

            if (checkOnly) {
                recordFailure(level, label, result.why, true);
                if (guide && level !== 'personal') ui.guide(await guide(ctx));
                return false;
            }
            if (fix && !autoTried) {
                autoTried = true;
                const defaultYes = level === 'required' || (level === 'optional' && withOptional);
                const question = `Posso tentar resolver automaticamente${fixDesc ? ` (${fixDesc})` : ''}?`;
                if (item.autoConfirm || await confirm(question, defaultYes)) {
                    await applyFix(item);
                    continue;
                }
            }
            if (guide) ui.guide(await guide(ctx));
            if (await waitRecheck()) continue;
            recordFailure(level, label, result.why, false);
            return false;
        }
    }

    const runner = {
        ctx, ui, options, report, ensure, confirm, record,
        info: (message) => ui.info(message),
        warn: (message) => ui.warn(message),
        hasFailures: () => report.fail.length > 0,
    };

    ui.intro(title);
    let stopped;
    try {
        for (const [index, section] of sections.entries()) {
            ui.step(`PASSO ${index + 1}/${sections.length}: ${section.title}`);
            if (section.why?.length) ui.message(pc.dim(section.why.join('\n')));
            await section.run(runner);
        }
    } catch (error) {
        if (!(error instanceof Stop)) throw error;
        stopped = error;
    }

    const summary = formatReport(report);
    if (summary) ui.note(summary, 'Resumo');
    if (stopped) ui.warn(stopped.message);

    const exitCode = stopped ? stopped.exitCode : (report.fail.length ? EXIT_PENDING : EXIT_OK);
    const success = typeof successMessage === 'function' ? successMessage(ctx) : successMessage;
    ui.outro(exitCode === EXIT_OK ? (success ?? 'Nenhuma pendencia obrigatoria.') : `Ha ${report.fail.length} pendencia(s) obrigatoria(s).`);
    return { exitCode, report, stopped: stopped?.message };
}
