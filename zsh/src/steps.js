import { access, copyFile, mkdir, readFile, rename, symlink, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { APT_PACKAGES, CUSTOM_REPOS, OMZ_INSTALL_URL, OPTIONAL_APT_PACKAGES, THEME_ENTRY } from './config.js';
import { renderZshrc } from './render.js';

const exists = (path) => access(path).then(() => true, () => false);
const timestamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

/**
 * Cria as etapas da pipeline. Dependencias (home, executor de comandos) sao injetadas.
 * @param {{ home: string, templatesDir: string, exec: Function, currentShell?: string, changeShell?: boolean }} options
 */
export function createSteps({ home, templatesDir, exec, currentShell = '', changeShell = true }) {
    const omzDir = join(home, '.oh-my-zsh');
    const customDir = join(omzDir, 'custom');
    const zshrc = join(home, '.zshrc');
    const zshrcLocal = join(home, '.zshrc.local');

    const isAptInstalled = (pkg) => exec('dpkg', ['-s', pkg]).then(() => true, () => false);
    const allInstalled = async (packages) => (await Promise.all(packages.map(isAptInstalled))).every(Boolean);
    const aptInstall = (packages) => exec('sudo', ['apt-get', 'install', '-y', ...packages], { interactive: true });

    const installPackages = {
        title: 'Instalar pacotes (git, curl, zsh, bat)',
        interactive: true,
        skip: () => allInstalled(APT_PACKAGES),
        run: async () => {
            await exec('sudo', ['apt-get', 'update', '-qq'], { interactive: true });
            await aptInstall(APT_PACKAGES);
        },
    };

    const installOptionalPackages = {
        title: `Instalar pacotes opcionais (${OPTIONAL_APT_PACKAGES.join(', ')})`,
        interactive: true,
        optional: true,
        skip: () => allInstalled(OPTIONAL_APT_PACKAGES),
        run: () => aptInstall(OPTIONAL_APT_PACKAGES),
    };

    const installOhMyZsh = {
        title: 'Instalar oh-my-zsh',
        skip: () => exists(omzDir),
        run: () => exec('sh', ['-c', `sh -c "$(curl -fsSL ${OMZ_INSTALL_URL})"`], {
            env: { RUNZSH: 'no', CHSH: 'no', KEEP_ZSHRC: 'yes' },
        }),
    };

    const customRepoSteps = CUSTOM_REPOS.map(({ kind, name, url }) => {
        const target = join(customDir, kind, name);
        return {
            title: `Instalar ${kind === 'themes' ? 'tema' : 'plugin'} ${name}`,
            run: async () => {
                if (await exists(join(target, '.git'))) {
                    await exec('git', ['-C', target, 'pull', '--ff-only', '-q']);
                    return;
                }
                await mkdir(join(customDir, kind), { recursive: true });
                await exec('git', ['clone', '--depth=1', url, target]);
            },
        };
    });

    const linkTheme = {
        title: 'Linkar o tema spaceship',
        run: async () => {
            const link = join(customDir, 'themes', THEME_ENTRY);
            await rm(link, { force: true });
            await symlink(join(customDir, 'themes', 'spaceship-prompt', THEME_ENTRY), link);
        },
    };

    const writeZshrc = {
        title: 'Escrever ~/.zshrc',
        run: async () => {
            if (await exists(zshrc)) await rename(zshrc, `${zshrc}.backup.${timestamp()}`);
            const template = await readFile(join(templatesDir, 'zshrc'), 'utf8');
            await writeFile(zshrc, renderZshrc(template));
        },
    };

    const writeZshrcLocal = {
        title: 'Criar ~/.zshrc.local',
        skip: () => exists(zshrcLocal),
        run: () => copyFile(join(templatesDir, 'zshrc.local'), zshrcLocal),
    };

    const setDefaultShell = {
        title: 'Definir zsh como shell padrao',
        interactive: true,
        skip: async () => !changeShell || basename(currentShell) === 'zsh',
        run: async () => {
            const { output } = await exec('sh', ['-c', 'command -v zsh']);
            await exec('chsh', ['-s', output.trim()], { interactive: true });
        },
    };

    const verify = {
        title: 'Verificar a instalacao',
        run: async () => {
            const { output } = await exec('zsh', ['-ic', 'echo THEME=$ZSH_THEME']);
            if (!output.includes('THEME=spaceship')) throw new Error('O zsh nao carregou o tema spaceship.');
        },
    };

    return [
        installPackages,
        installOptionalPackages,
        installOhMyZsh,
        ...customRepoSteps,
        linkTheme,
        writeZshrc,
        writeZshrcLocal,
        setDefaultShell,
        verify,
    ];
}
