import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import { dockerInstallCommands, dockerReleaseUrl, FALLBACK_CODENAME } from '../docker-install.js';

const DOCKER_RUN_TIMEOUT_MS = 180_000;
const RELEASE_CHECK_TIMEOUT_S = '15';
const SHIM_MODE = 0o755;

/** Estado do grupo docker: effective (vale neste terminal) | pending (no grupo, terminal antigo) | absent. */
export async function dockerGroupState(ctx) {
    const current = (await ctx.capture('id', ['-nG'])).output.split(/\s+/);
    if (current.includes('docker')) return 'effective';
    const members = (await ctx.capture('getent', ['group', 'docker'])).output;
    return new RegExp(`[:,]${ctx.user}(,|$)`, 'm').test(members.trim()) ? 'pending' : 'absent';
}

export function dockerItems(ctx) {
    const aptInstall = async (...packages) => {
        if (!await ctx.ensureSudo()) return false;
        await ctx.x('sudo', ['apt-get', 'update']);
        await ctx.x('sudo', ['apt-get', 'install', '-y', ...packages]);
        return true;
    };

    const installDocker = async () => {
        if (!await ctx.ensureSudo()) return false;
        const distro = ctx.platform.osId === 'debian' ? 'debian' : 'ubuntu';
        let codename = ctx.platform.codename || FALLBACK_CODENAME;
        const arch = (await ctx.capture('dpkg', ['--print-architecture'])).output.trim() || 'amd64';
        const published = await ctx.capture('curl', ['-fsI', '--max-time', RELEASE_CHECK_TIMEOUT_S, dockerReleaseUrl(distro, codename)]);
        if (!published.ok && distro === 'ubuntu') {
            ctx.ui.info(`A Docker ainda nao publica pacotes para "${codename}"; usando "${FALLBACK_CODENAME}" (Ubuntu 24.04), que e compativel.`);
            codename = FALLBACK_CODENAME;
        }
        for (const [command, args] of dockerInstallCommands({ distro, codename, arch })) await ctx.x(command, args);
        return true;
    };

    const fixGroup = async () => {
        if ((await dockerGroupState(ctx)) === 'absent') {
            if (!await ctx.ensureSudo()) return false;
            await ctx.x('sudo', ['usermod', '-aG', 'docker', ctx.user]);
        }
        ctx.ui.guide([
            'O grupo so vale em terminais NOVOS. Para aplicar:',
            '  1. Feche TODAS as janelas do Ubuntu;',
            '  2. (se ainda nao funcionar) no PowerShell do Windows:  wsl --shutdown ;',
            '  3. Abra o Ubuntu e rode a pipeline de novo.',
            'Enquanto isso, continuo as verificacoes usando "sg docker".',
        ]);
        ctx.dockerViaSg = true;
        return false;
    };

    const shim = join(ctx.home, '.local', 'bin', 'docker-compose');

    return {
        installed: {
            label: 'Docker instalado',
            fixDesc: 'instalar pelo repositorio oficial da Docker',
            check: async () => {
                const version = await ctx.capture('docker', ['--version']);
                if (!version.ok) return fail('Docker nao instalado');
                const located = await ctx.capture('sh', ['-c', 'command -v docker']);
                const path = located.ok ? located.output.trim() : '';
                return pass(`${version.output.trim()}${path.startsWith('/mnt/c/') ? ' · ATENCAO: e o docker.exe do Windows' : ''}`);
            },
            fix: installDocker,
            guide: () => [
                'Instale o Docker Engine pelo guia oficial (Ubuntu):  https://docs.docker.com/engine/install/ubuntu/',
                'Escolha "Install using the apt repository". NAO precisa do Docker Desktop (o toolkit foi validado com o Engine no WSL).',
            ],
        },
        service: {
            label: 'Servico docker ativo',
            fixDesc: 'systemctl enable --now docker',
            check: async () => ((await ctx.capture('systemctl', ['is-active', '--quiet', 'docker'])).ok ? pass('servico docker ativo') : fail('o servico docker nao esta rodando')),
            fix: async () => {
                if (!await ctx.ensureSudo()) return false;
                await ctx.x('sudo', ['systemctl', 'enable', '--now', 'docker']);
            },
            guide: () => ['  sudo systemctl enable --now docker', 'Se der erro de systemd, volte ao PASSO 1 (systemd) e reinicie o WSL.'],
        },
        group: {
            label: 'Usuario no grupo docker',
            fixDesc: 'adicionar voce ao grupo docker',
            check: async () => {
                const state = await dockerGroupState(ctx);
                if (state === 'effective') return pass('usuario no grupo docker (docker sem sudo)');
                if (state === 'pending') return fail('voce JA esta no grupo docker, mas este terminal foi aberto antes disso');
                return fail('seu usuario nao esta no grupo docker (precisaria de sudo para todo comando docker)');
            },
            fix: fixGroup,
            guide: () => [
                'Feche todas as janelas do Ubuntu e abra de novo (ou, no PowerShell:  wsl --shutdown ).',
                `Se ainda faltar:  sudo usermod -aG docker ${ctx.user}   e repita.`,
            ],
        },
        daemon: {
            label: 'Daemon do Docker acessivel',
            check: async () => {
                const direct = await ctx.capture('docker', ['info', '--format', 'Docker {{.ServerVersion}} · {{.Driver}}']);
                if (direct.ok) return pass(`daemon acessivel · ${direct.output.trim()}`);
                if ((await ctx.capture('sg', ['docker', '-c', 'docker info'])).ok) {
                    ctx.dockerViaSg = true;
                    return pass('daemon acessivel apenas via "sg docker" (grupo docker pendente neste terminal)');
                }
                return fail('nao consegui falar com o daemon do Docker');
            },
            guide: () => [
                'Verifique:  systemctl status docker   e   docker info',
                'Erro "permission denied ... docker.sock" = falta o grupo docker (veja o item acima).',
            ],
        },
        compose: {
            label: 'docker compose (plugin v2)',
            fixDesc: 'apt-get install docker-compose-plugin',
            check: async () => {
                const result = await ctx.capture('docker', ['compose', 'version']);
                return result.ok ? pass(result.output.trim()) : fail('plugin "docker compose" ausente');
            },
            fix: () => aptInstall('docker-compose-plugin'),
            guide: () => ['  sudo apt-get install -y docker-compose-plugin'],
        },
        buildx: {
            label: 'docker buildx',
            fixDesc: 'apt-get install docker-buildx-plugin',
            check: async () => {
                const result = await ctx.capture('docker', ['buildx', 'version']);
                return result.ok ? pass(result.output.trim().slice(0, 50)) : fail('plugin "docker buildx" ausente (o build das imagens usa buildx)');
            },
            fix: () => aptInstall('docker-buildx-plugin'),
            guide: () => ['  sudo apt-get install -y docker-buildx-plugin'],
        },
        composeV1: {
            label: 'Atalho "docker-compose" (v1)',
            level: 'optional',
            fixDesc: 'criar ~/.local/bin/docker-compose',
            check: async () => {
                const found = await ctx.capture('sh', ['-c', 'command -v docker-compose']);
                return found.ok && found.output.trim() ? pass(found.output.trim()) : fail('comando antigo "docker-compose" inexistente; os scripts tentam ele primeiro e so depois "docker compose" (funciona, mas imprime "command not found")');
            },
            fix: async () => {
                await mkdir(join(ctx.home, '.local', 'bin'), { recursive: true });
                await writeFile(shim, '#!/bin/sh\n# atalho criado pela pipeline suite-dev: repassa para o plugin novo\nexec docker compose "$@"\n');
                await chmod(shim, SHIM_MODE);
            },
            guide: () => ['Opcional. Crie ~/.local/bin/docker-compose com:  exec docker compose "$@"'],
        },
        run: {
            label: 'Docker consegue rodar containers',
            check: async () => {
                const result = await ctx.dk(['run', '--rm', 'hello-world'], { timeoutMs: DOCKER_RUN_TIMEOUT_MS });
                return result.ok ? pass('baixou e executou a imagem hello-world') : fail('nao consegui baixar/rodar a imagem hello-world');
            },
            guide: () => [
                'Teste na mao para ver o erro completo:  docker run --rm hello-world',
                'Causas comuns: sem internet/VPN, grupo docker pendente, disco cheio, daemon parado.',
            ],
        },
    };
}

export const dockerSection = {
    title: 'Docker Engine, Compose e Buildx',
    why: [
        'Bancos (Postgres, MongoDB, Redis, RabbitMQ...) rodam em containers Docker.',
        'Precisa do Docker Engine, dos plugins "docker compose" e "buildx" e do seu usuario no grupo "docker".',
    ],
    run: async (runner) => {
        const items = dockerItems(runner.ctx);
        if (!await runner.ensure(items.installed)) return;
        await runner.ensure(items.service);
        await runner.ensure(items.group);
        await runner.ensure(items.daemon);
        await runner.ensure(items.compose);
        await runner.ensure(items.buildx);
        await runner.ensure(items.composeV1);
        await runner.ensure(items.run);
    },
};
