/**
 * Extrai o BasePath (pasta do disco virtual) de uma distro a partir da saida de
 * `reg.exe query HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss /s`.
 */
export function parseLxssBasePath(regText, distroName) {
    const blocks = regText.replace(/\r|\0/g, '').split(/^HKEY/m);
    for (const block of blocks) {
        const name = block.match(/DistributionName\s+REG_SZ\s+(.+)/)?.[1].trim();
        const basePath = block.match(/BasePath\s+REG_SZ\s+(.+)/)?.[1].trim();
        if (name === distroName && basePath) return basePath;
    }
    return '';
}
