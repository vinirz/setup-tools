import { access } from 'node:fs/promises';

/** true se o caminho existe (arquivo, diretorio ou link). */
export const exists = (path) => access(path).then(() => true, () => false);
