/** GB livres a partir da saida de `df -BG --output=avail <pasta>`; null se nao der para medir. */
export function parseDiskGb(dfOutput = '') {
    const last = dfOutput.trim().split('\n').at(-1) ?? '';
    const digits = last.replace(/\D/g, '');
    return digits === '' ? null : Number(digits);
}

/** GB totais de RAM a partir da saida de `free -g`; null se nao der para medir. */
export function parseMemoryGb(freeOutput = '') {
    const match = freeOutput.match(/^Mem:\s+(\d+)/m);
    return match ? Number(match[1]) : null;
}

/** Primeira linha nao vazia, limitada a `max` caracteres. */
export function firstLine(text = '', max = 70) {
    return (text.split('\n').find((line) => line.trim()) ?? '').trim().slice(0, max).trimEnd();
}

/** Major de uma versao como "v24.18.0" ou "24.1"; 0 se nao reconhecer. */
export function majorOf(version = '') {
    const match = version.trim().match(/^v?(\d+)/);
    return match ? Number(match[1]) : 0;
}
