import { SYMBOLS } from './config.js';

/** Substitui os placeholders do template pelos glifos reais. */
export function renderZshrc(template, symbols = SYMBOLS) {
    return Object.entries(symbols).reduce(
        (content, [placeholder, value]) => content.replaceAll(placeholder, value),
        template,
    );
}
