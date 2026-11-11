import { basename, join } from 'node:path';
import { ALIAS_BLOCK, RC_BLOCK } from './config.js';

/** Bloco gerenciado: nvm, NXTOOLKITBASEPATH e PATH (permite rodar `nx` de qualquer pasta). */
export function renderBlock(nxDir) {
    return [
        RC_BLOCK.start,
        '# Permite rodar o comando `nx` de qualquer pasta.',
        'export NVM_DIR="$HOME/.nvm"',
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
        `export NXTOOLKITBASEPATH="${nxDir}"`,
        'case ":$PATH:" in *":$NXTOOLKITBASEPATH:"*) ;; *) export PATH="$PATH:$NXTOOLKITBASEPATH" ;; esac',
        RC_BLOCK.end,
    ].join('\n');
}

/** Atalhos de navegacao (pessoais). */
export function renderAliasBlock(nxDir) {
    return [
        ALIAS_BLOCK.start,
        `alias cdww="cd ${nxDir}/"`,
        `alias cdfb="cd ${nxDir}/sources/nx-suite-fullbackend/"`,
        `alias cdfn="cd ${nxDir}/sources/nx-suite-front-novo/"`,
        ALIAS_BLOCK.end,
    ].join('\n');
}

/** Insere o bloco ou substitui o anterior (idempotente). */
export function upsertBlock(content, block, markers = RC_BLOCK) {
    const start = content.indexOf(markers.start);
    const end = content.indexOf(markers.end);
    if (start !== -1 && end > start) {
        return content.slice(0, start) + block + content.slice(end + markers.end.length);
    }
    const separator = content === '' || content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}\n${block}\n`;
}

const normalizePath = (value, home) => value
    .replace(/^["']|["']$/g, '')
    .replace(/^\$\{?HOME\}?/, home)
    .replace(/^~/, home);

/** Estado de NXTOOLKITBASEPATH em um arquivo: none | ok | other (aponta para outro lugar). */
export function nxState(content, nxDir, home) {
    const matches = [...content.matchAll(/NXTOOLKITBASEPATH=(\S+)/g)];
    if (matches.length === 0) return { kind: 'none' };
    const value = normalizePath(matches.at(-1)[1], home);
    return value === nxDir || value === `${nxDir}/` ? { kind: 'ok' } : { kind: 'other', value };
}

/**
 * Arquivo principal do shell. No zsh, prefere ~/.zshrc.local quando o ~/.zshrc o carrega
 * (assim o setup do zsh nao o apaga).
 */
export async function primaryRcFile(ctx) {
    if (basename(ctx.shell) !== 'zsh') return join(ctx.home, '.bashrc');
    const zshrc = join(ctx.home, '.zshrc');
    return (await ctx.readText(zshrc)).includes('.zshrc.local') ? join(ctx.home, '.zshrc.local') : zshrc;
}

/** Arquivos que recebem o bloco: o principal e, se for outro, o ~/.bashrc. */
export async function rcFiles(ctx) {
    const primary = await primaryRcFile(ctx);
    const bashrc = join(ctx.home, '.bashrc');
    return primary === bashrc ? [primary] : [primary, bashrc];
}
