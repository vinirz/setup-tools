import { SETUP_HINTS } from './config.js';

const MIGRATION_ISSUE = /feature_toggle|does not exist|duplicate key value violates unique constraint/i;
const SILENT_FAILURE = /npm error|ERR!|command not found: pnpm|Error executing|permission denied|fatal:/i;

/** Orientacoes para os erros reconhecidos na saida de um comando do nx. */
export function setupHints(output = '') {
    return SETUP_HINTS.filter(([pattern]) => pattern.test(output)).map(([, hint]) => hint);
}

/** true se o erro e um dos problemas conhecidos das migrations em instalacao do zero. */
export const isKnownMigrationIssue = (output = '') => MIGRATION_ISSUE.test(output);

/** Os scripts do nx nem sempre retornam codigo de erro: detecta falhas na propria saida. */
export const hasSilentFailure = (output = '') => SILENT_FAILURE.test(output);
