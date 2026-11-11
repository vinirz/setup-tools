import { hasSilentFailure, isKnownMigrationIssue, setupHints } from './hints.js';

const UNRECOGNIZED_ERROR = 'Nao reconheci o erro. Veja o final da saida acima e mande ao time.';

/**
 * Cria o executor de `nx <args>`: roda em tempo real e, em caso de falha, mostra as orientacoes
 * reconhecidas. Os scripts do nx nem sempre retornam codigo de erro, entao a saida tambem e inspecionada.
 */
export function createNxRun(ctx) {
    return async function nxRun(args) {
        try {
            const { output } = await ctx.nx(args);
            if (hasSilentFailure(output)) {
                const error = new Error(`"nx ${args}" terminou com erros na saida.`);
                error.output = output;
                throw error;
            }
        } catch (error) {
            const output = error.output ?? '';
            const hints = setupHints(output);
            ctx.ui.guide(hints.length ? hints : [UNRECOGNIZED_ERROR]);
            if (isKnownMigrationIssue(output)) ctx.showKnownIssues = true;
            throw error;
        }
    };
}
