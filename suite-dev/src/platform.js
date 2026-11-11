import { release } from 'node:os';

/** Interpreta o conteudo de /etc/os-release. */
export function parseOsRelease(text = '') {
    const values = Object.fromEntries(
        text.split('\n')
            .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
            .filter(Boolean)
            .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]),
    );
    return {
        osId: values.ID ?? '',
        osLike: values.ID_LIKE ?? '',
        codename: values.VERSION_CODENAME ?? '',
        prettyName: values.PRETTY_NAME ?? '',
    };
}

/** Detecta WSL (e versao), sistema e arquitetura. `read` e `kernelRelease` sao injetaveis para teste. */
export async function detectPlatform({ read, kernelRelease = release(), arch = process.arch } = {}) {
    const safeRead = async (path) => read(path).catch(() => '');
    const isWsl = /microsoft/i.test(await safeRead('/proc/version'));
    return {
        isWsl,
        wslVersion: isWsl ? (/wsl2/i.test(kernelRelease) ? 2 : 1) : 0,
        arch: arch === 'x64' ? 'x86_64' : arch,
        ...parseOsRelease(await safeRead('/etc/os-release')),
    };
}
