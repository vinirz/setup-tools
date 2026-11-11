const SECTION_HEADER = /^\s*\[([^\]]+)\]\s*$/;

/**
 * Define `chave=valor` dentro de `[secao]` em um conteudo .ini (ex.: /etc/wsl.conf).
 * Cria a secao se faltar; substitui a chave se existir; preserva o resto.
 */
export function setIniOption(content, section, key, value) {
    const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n');
    const start = lines.findIndex((line) => SECTION_HEADER.exec(line)?.[1].trim() === section);
    const entry = `${key}=${value}`;

    if (start === -1) {
        const separator = lines.length ? [''] : [];
        return `${[...lines, ...separator, `[${section}]`, entry].join('\n')}\n`;
    }

    let end = lines.findIndex((line, index) => index > start && SECTION_HEADER.test(line));
    if (end === -1) end = lines.length;

    const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
    const existing = lines.findIndex((line, index) => index > start && index < end && keyPattern.test(line));
    if (existing !== -1) lines[existing] = entry;
    else lines.splice(start + 1, 0, entry);
    return `${lines.join('\n')}\n`;
}

/** true se `[secao]` ja define `chave=valor`. */
export function hasIniOption(content, section, key, value) {
    const lines = content.split('\n');
    const start = lines.findIndex((line) => SECTION_HEADER.exec(line)?.[1].trim() === section);
    if (start === -1) return false;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => SECTION_HEADER.test(line));
    const body = end === -1 ? rest : rest.slice(0, end);
    return body.some((line) => new RegExp(`^\\s*${key}\\s*=\\s*${value}\\s*$`).test(line));
}
