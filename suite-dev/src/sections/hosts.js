import { fail, pass } from '../../../common/tui/src/index.js';
import { HOSTS_MARKER, MIN_HOSTS_ENTRIES } from '../config.js';
import { hasIniOption, setIniOption } from '../ini.js';
import { createNxRun } from '../nx-run.js';

const WSL_CONF = '/etc/wsl.conf';

/**
 * Hosts do toolkit. Usados no setup (com correcao) e na verificacao final.
 * Ordem correta: `generateHosts=false` no /etc/wsl.conf e depois `nx init-hosts`
 * (sem isso o WSL recria o /etc/hosts a cada reinicio e apaga as entradas #NXT).
 * O `nx init-hosts` precisa do ENVIROMENT (VIRTUAL_HOSTS_MAIN_DOMAIN) e do sudo.
 */
export function hostsItems(ctx) {
    const nxRun = createNxRun(ctx);

    return {
        generateHosts: {
            label: '/etc/wsl.conf com generateHosts=false',
            fixDesc: 'gravar [network] generateHosts=false no /etc/wsl.conf',
            check: async () => {
                if (!ctx.platform.isWsl) return pass('nao e WSL');
                return hasIniOption(await ctx.readText(WSL_CONF), 'network', 'generateHosts', 'false')
                    ? pass('o WSL nao recria o /etc/hosts a cada reinicio')
                    : fail('o WSL recria o /etc/hosts a cada reinicio e APAGA as entradas #NXT');
            },
            fix: async () => {
                if (!await ctx.ensureSudo()) return false;
                await ctx.writeRootFile(WSL_CONF, setIniOption(await ctx.readText(WSL_CONF), 'network', 'generateHosts', 'false'));
                ctx.wslRestartNeeded = true;
                ctx.ui.info('/etc/wsl.conf atualizado. Vale a partir do proximo reinicio do WSL (wsl --shutdown).');
                return true;
            },
            guide: () => [
                'Em /etc/wsl.conf adicione:',
                '  [network]',
                '  generateHosts = false',
                'e reinicie o WSL (no PowerShell do Windows: wsl --shutdown).',
            ],
        },
        hostsLinux: {
            label: 'Hosts no Linux (/etc/hosts)',
            fixDesc: "rodar 'nx init-hosts'",
            check: async () => {
                const count = (await ctx.readText('/etc/hosts')).split('\n').filter((line) => line.includes(HOSTS_MARKER)).length;
                return count > MIN_HOSTS_ENTRIES ? pass(`${count} entradas ${HOSTS_MARKER} em /etc/hosts`) : fail('/etc/hosts sem as entradas do toolkit (#NXT)');
            },
            fix: async () => {
                if (!await ctx.ensureSudo()) return false; // o init-hosts usa sudo: aquece a senha antes
                await nxRun('init-hosts');
                return true;
            },
            guide: () => ['  nx init-hosts   (precisa do arquivo ENVIROMENT e de sudo)'],
        },
    };
}
