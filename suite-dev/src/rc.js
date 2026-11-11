import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BLOCK_END, BLOCK_START } from './config.js';
import { exists } from '../../common/tui/src/index.js';

/** Bloco gerenciado com as variaveis do nx. */
export function renderBlock(projectDir) {
    return [
        BLOCK_START,
        `export NXTOOLKITBASEPATH="${projectDir}"`,
        `export PATH="$PATH:${projectDir}"`,
        BLOCK_END,
    ].join('\n');
}

/** Insere o bloco ou substitui o anterior (idempotente). */
export function upsertBlock(content, block) {
    const start = content.indexOf(BLOCK_START);
    const end = content.indexOf(BLOCK_END);
    if (start !== -1 && end > start) {
        return content.slice(0, start) + block + content.slice(end + BLOCK_END.length);
    }
    const separator = content === '' || content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}\n${block}\n`;
}

/**
 * Arquivo de configuracao do shell que recebe o bloco.
 * No zsh, prefere ~/.zshrc.local quando o ~/.zshrc o carrega (assim o setup do zsh nao o apaga).
 */
export async function chooseRcFile({ home, shell = '' }) {
    if (basename(shell) !== 'zsh') return join(home, '.bashrc');
    const zshrc = join(home, '.zshrc');
    if (await exists(zshrc) && (await readFile(zshrc, 'utf8')).includes('.zshrc.local')) {
        return join(home, '.zshrc.local');
    }
    return zshrc;
}
