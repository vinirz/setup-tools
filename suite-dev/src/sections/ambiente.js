import { fail, pass, Stop } from '../../../common/tui/src/index.js';
import { INTERNET_URLS, MIN_DISK_GB, MIN_MEM_GB } from '../config.js';
import { hasIniOption, setIniOption } from '../ini.js';
import { parseDiskGb, parseMemoryGb } from '../parse.js';
import { parseLxssBasePath } from '../wsl.js';

const REG_QUERY_TIMEOUT_MS = 20_000;
const POWERSHELL_TIMEOUT_MS = 25_000;
const WSL_CONF = '/etc/wsl.conf';

export function ambienteItems(ctx) {
    const { platform } = ctx;
    const osName = platform.prettyName || platform.osId;

    const systemdFix = async () => {
        if (!await ctx.ensureSudo()) return false;
        const conf = await ctx.readText(WSL_CONF);
        if (hasIniOption(conf, 'boot', 'systemd', 'true')) {
            ctx.ui.info('/etc/wsl.conf ja tem systemd=true; falta reiniciar o WSL.');
        } else {
            await ctx.writeRootFile(WSL_CONF, setIniOption(conf, 'boot', 'systemd', 'true'));
            ctx.ui.success('/etc/wsl.conf: systemd=true gravado');
        }
        ctx.ui.guide([
            'E PRECISO REINICIAR O WSL para ativar o systemd:',
            '  1. Feche TODAS as janelas do Ubuntu.',
            '  2. No PowerShell do Windows rode:  wsl --shutdown',
            '  3. Abra o Ubuntu de novo e rode esta pipeline outra vez.',
        ]);
        throw new Stop('Reinicie o WSL e rode a pipeline de novo.');
    };

    const sparseCheck = async () => {
        if (!platform.isWsl) return pass('nao e WSL');
        if (!(await ctx.has('reg.exe') && await ctx.has('powershell.exe'))) {
            return fail('nao consegui verificar (interop com o Windows indisponivel)');
        }
        const reg = await ctx.capture('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss', '/s'], { timeoutMs: REG_QUERY_TIMEOUT_MS });
        const base = parseLxssBasePath(reg.output, ctx.env.WSL_DISTRO_NAME ?? 'Ubuntu');
        if (!base) return fail('nao consegui localizar o disco virtual para verificar');
        const vhd = `${base}\\ext4.vhdx`;
        const attrs = await ctx.capture('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${vhd}').Attributes.ToString()`], { timeoutMs: POWERSHELL_TIMEOUT_MS });
        const text = attrs.output.replace(/\r|\0/g, '').trim();
        if (!text) return fail('nao consegui ler os atributos do disco virtual para verificar');
        return text.includes('SparseFile')
            ? pass('disco virtual esparso: o espaco apagado no Ubuntu volta ao Windows')
            : fail('o disco virtual do WSL NAO e esparso: ao apagar imagens Docker o espaco NAO volta para o Windows');
    };

    return [
        {
            label: 'Usuario nao e root',
            check: async () => (ctx.uid !== 0 ? pass(`usuario: ${ctx.user}`) : fail('voce esta como root')),
            guide: () => [
                'O toolkit (nx) recusa rodar como root e isso pode desorganizar as permissoes dos seus arquivos.',
                'Abra o Ubuntu com o usuario criado na instalacao do WSL e rode a pipeline sem sudo.',
            ],
        },
        {
            label: 'WSL2 / plataforma',
            check: async () => {
                if (platform.isWsl && platform.wslVersion === 2) return pass(`WSL2 · ${osName} · ${platform.arch}`);
                if (platform.isWsl) return fail('voce esta no WSL1 (o Docker nao funciona bem nele)');
                return pass(`Linux nativo (${osName}); os passos do Windows serao ignorados`);
            },
            guide: () => [
                'Converta a distro para WSL2. No PowerShell do Windows:',
                '  wsl -l -v                       # veja a coluna VERSION',
                '  wsl --set-version Ubuntu 2      # troque "Ubuntu" pelo nome mostrado acima',
                'Depois abra o Ubuntu de novo e rode a pipeline.',
            ],
        },
        {
            label: 'Sistema operacional (Ubuntu)',
            check: async () => {
                const supported = ['ubuntu', 'debian'].includes(platform.osId) || platform.osLike.includes('debian');
                return supported ? pass(osName) : fail(`sistema "${osName || 'desconhecido'}" nao e Ubuntu/Debian (a pipeline usa apt)`);
            },
            guide: () => [
                'Esta pipeline foi feita para Ubuntu (recomendado: 22.04 ou mais novo) no WSL2.',
                'No PowerShell do Windows (Administrador):  wsl --install -d Ubuntu',
            ],
        },
        {
            label: 'Arquitetura x86_64',
            level: 'optional',
            check: async () => (platform.arch === 'x86_64' ? pass(platform.arch) : fail(`arquitetura ${platform.arch} (algumas imagens do toolkit sao x86_64)`)),
            guide: () => ['Em maquinas ARM algumas imagens Docker/ferramentas podem nao funcionar. Fale com o time antes de continuar.'],
        },
        {
            label: 'systemd ativo',
            check: async () => {
                if (await ctx.fileExists('/run/systemd/system')) return pass('systemd ativo');
                return fail(platform.isWsl ? 'o systemd nao esta habilitado neste WSL (o Docker precisa dele)' : 'systemd nao esta ativo');
            },
            fix: platform.isWsl ? systemdFix : undefined,
            fixDesc: 'gravar systemd=true em /etc/wsl.conf',
            guide: () => [
                'Habilite o systemd: edite /etc/wsl.conf (sudo nano /etc/wsl.conf) e deixe assim:',
                '  [boot]',
                '  systemd=true',
                'Depois, no PowerShell do Windows:  wsl --shutdown   e abra o Ubuntu de novo.',
            ],
        },
        {
            label: 'Permissao de sudo',
            check: async () => {
                if (!await ctx.has('sudo')) return fail('o comando sudo nao existe');
                if ((await ctx.capture('sudo', ['-n', 'true'])).ok) return pass('sudo liberado');
                const groups = (await ctx.capture('id', ['-nG'])).output.split(/\s+/);
                if (groups.some((group) => ['sudo', 'admin', 'wheel'].includes(group))) {
                    return pass('usuario esta no grupo sudo (a senha sera pedida quando necessario)');
                }
                return fail('seu usuario nao esta no grupo sudo');
            },
            guide: () => [
                'Seu usuario precisa poder usar sudo. Se voce e o dono do WSL, no PowerShell do Windows:',
                `  wsl -u root usermod -aG sudo ${ctx.user}`,
                'Feche e abra o Ubuntu de novo.',
            ],
        },
        {
            label: 'Acesso a internet',
            check: async () => {
                const results = await Promise.all(INTERNET_URLS.map(async (url) => [url, (await ctx.capture('curl', ['-fsS', '-o', '/dev/null', '-I', '--max-time', '10', url])).ok]));
                const bad = results.filter(([, ok]) => !ok).map(([url]) => url);
                return bad.length === 0 ? pass('github, bitbucket, npm, docker e nodejs acessiveis') : fail(`sem acesso a: ${bad.join(' ')}`);
            },
            guide: () => [
                'Sem acesso a alguns sites necessarios. Verifique: internet/VPN da empresa, proxy e DNS do WSL.',
                'Teste manual:  curl -I https://github.com',
                'Se o DNS falha so no WSL:  echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf   (e reinicie o WSL).',
            ],
        },
        {
            label: 'Espaco livre em disco',
            level: 'optional',
            check: async () => {
                const gb = parseDiskGb((await ctx.capture('df', ['-BG', '--output=avail', ctx.home])).output);
                if (gb === null) return pass('nao consegui medir');
                return gb >= MIN_DISK_GB ? pass(`${gb} GB livres`) : fail(`so ${gb} GB livres (recomendado >= ${MIN_DISK_GB} GB)`);
            },
            guide: () => [
                'As imagens Docker, node_modules e bancos ocupam bastante. Libere espaco no disco do Windows (C:) e no WSL.',
                'Dentro do WSL:  docker system df   e   docker builder prune -af',
            ],
        },
        {
            label: 'Memoria / CPUs do WSL',
            level: 'optional',
            check: async () => {
                const gb = parseMemoryGb((await ctx.capture('free', ['-g'])).output);
                if (gb === null) return pass('nao consegui medir');
                const cpus = (await ctx.capture('nproc')).output.trim();
                // `free -g` arredonda para baixo: 7 GB ja e "8 GB" configurado.
                return gb >= MIN_MEM_GB - 1 ? pass(`${gb} GB de RAM · ${cpus} CPUs`) : fail(`apenas ${gb} GB de RAM para o WSL (recomendado >= ${MIN_MEM_GB} GB)`);
            },
            guide: () => [
                'O WSL usa por padrao metade da RAM do Windows. Para aumentar, crie/edite no Windows o arquivo',
                'C:\\Users\\<seu-usuario>\\.wslconfig com:',
                '  [wsl2]',
                '  memory=12GB',
                '  processors=6',
                'Depois:  wsl --shutdown  (PowerShell) e abra o Ubuntu de novo.',
            ],
        },
        {
            label: 'Disco do WSL devolve espaco ao Windows',
            level: 'optional',
            check: sparseCheck,
            guide: () => [
                'Para o Windows recuperar o espaco que voce apagar dentro do Ubuntu, ligue o modo esparso.',
                'No PowerShell do Windows (feche tudo que usa o WSL antes):',
                '  wsl --shutdown',
                `  wsl --manage ${ctx.env.WSL_DISTRO_NAME ?? 'Ubuntu'} --set-sparse true`,
                'Depois de apagar coisas no Ubuntu, rode uma vez:  sudo fstrim -av',
            ],
        },
    ];
}

export const ambienteSection = {
    title: 'Ambiente: WSL, sistema, rede, disco e memoria',
    why: [
        'Confere se o computador atende o minimo: usuario normal (nao root), WSL2 com Ubuntu, systemd (necessario ao Docker),',
        'sudo, internet, espaco em disco e memoria. Se algo aqui falhar, os passos seguintes podem falhar tambem.',
    ],
    run: async (runner) => {
        for (const item of ambienteItems(runner.ctx)) await runner.ensure(item);
    },
};
