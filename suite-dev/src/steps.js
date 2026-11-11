import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exists } from '../../common/tui/src/index.js';
import {
    BITBUCKET_SSH_KEYS_URL, DEFAULT_PARENT_DIR_NAME, DOCKER_INSTALL_COMMANDS,
    GIT_SSH_ENV, REPO_DIR_NAME, REPO_URL, SSH_KEY_FILE,
} from './config.js';
import { chooseRcFile, renderBlock, upsertBlock } from './rc.js';

const expandHome = (path, home) => (path.startsWith('~') ? join(home, path.slice(1)) : path);

/**
 * Cria as etapas da pipeline suite-dev. Dependencias sao injetadas (testes nao executam nada real).
 * @param {{ home: string, user: string, hostname?: string, shell?: string, exec: Function, parentDir?: string }} options
 */
export function createSteps({ home, user, hostname = 'dev', shell = '', exec, parentDir }) {
    const keyPath = join(home, '.ssh', SSH_KEY_FILE);
    const succeeds = (command, args, options) => exec(command, args, options).then(() => true, () => false);
    const aptInstall = (...packages) => exec('sudo', ['apt-get', 'install', '-y', ...packages], { interactive: true });
    const hasRepoAccess = () => succeeds('git', ['ls-remote', REPO_URL, 'HEAD'], { env: GIT_SSH_ENV });

    const chooseDirectory = {
        title: 'Escolher o diretorio de instalacao',
        interactive: true,
        run: async (context) => {
            const parent = parentDir
                ?? expandHome(await context.ui.text('Em qual pasta clonar o repositorio?', join(home, DEFAULT_PARENT_DIR_NAME)), home);
            context.projectDir = join(parent, REPO_DIR_NAME);
            context.ui.info(`Destino: ${context.projectDir}`);
        },
    };

    const installGit = {
        title: 'Instalar o git',
        interactive: true,
        skip: () => succeeds('git', ['--version']),
        run: async () => {
            await exec('sudo', ['apt-get', 'update', '-qq'], { interactive: true });
            await aptInstall('git');
        },
    };

    const installDocker = {
        title: 'Instalar o Docker',
        interactive: true,
        skip: () => succeeds('docker', ['--version']),
        run: async () => {
            const { output } = await exec('sh', ['-c', '. /etc/os-release && echo "$ID"']);
            if (output.trim() !== 'ubuntu') {
                throw new Error('A instalacao automatica do Docker so suporta Ubuntu. Veja https://devdocs.smartnx.io/docs/backend/ferramentas/docker');
            }
            for (const [command, args] of DOCKER_INSTALL_COMMANDS) {
                await exec(command, args, { interactive: true });
            }
        },
    };

    const addUserToDockerGroup = {
        title: 'Permitir o Docker sem sudo (grupo docker)',
        interactive: true,
        skip: async () => (await exec('id', ['-nG', user]).catch(() => ({ output: '' }))).output.split(/\s+/).includes('docker'),
        run: async (context) => {
            await exec('sudo', ['usermod', '-aG', 'docker', user], { interactive: true });
            context.dockerGroupAdded = true;
        },
    };

    const installPnpm = {
        title: 'Instalar o pnpm',
        skip: () => succeeds('pnpm', ['--version']),
        run: () => exec('npm', ['install', '-g', 'pnpm']),
    };

    const generateSshKey = {
        title: 'Gerar a chave SSH',
        skip: () => exists(keyPath),
        run: async () => {
            await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
            await exec('ssh-keygen', ['-t', 'ed25519', '-C', `${user}@${hostname}`, '-f', keyPath, '-N', '']);
        },
    };

    const authorizeSshKey = {
        title: 'Autorizar a chave SSH no Bitbucket',
        interactive: true,
        skip: hasRepoAccess,
        run: async ({ ui }) => {
            const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trim();
            ui.note(`${publicKey}\n\n1. Abra ${BITBUCKET_SSH_KEYS_URL}\n2. Clique em "Add key" e cole a chave acima.`, 'Chave publica SSH');
            for (;;) {
                if (!await ui.confirm('Chave adicionada. Verificar o acesso ao repositorio agora?')) {
                    throw new Error('Verificacao cancelada. Autorize a chave e execute a pipeline novamente.');
                }
                if (await hasRepoAccess()) {
                    ui.success('Acesso ao repositorio confirmado.');
                    return;
                }
                ui.warn(`Sem acesso a ${REPO_URL}. Confira se a chave foi adicionada e se voce tem permissao no repositorio.`);
            }
        },
    };

    const cloneRepository = {
        title: 'Clonar o repositorio nx-suite-docker',
        skip: (context) => exists(join(context.projectDir, '.git')),
        run: async (context) => {
            await mkdir(dirname(context.projectDir), { recursive: true });
            await exec('git', ['clone', REPO_URL, context.projectDir], { env: GIT_SSH_ENV });
        },
    };

    const fixOwnership = {
        title: 'Ajustar o dono dos arquivos (chown)',
        interactive: true,
        skip: async (context) => {
            const { output } = await exec('find', [context.projectDir, '!', '-user', user, '-print', '-quit'])
                .catch(() => ({ output: 'erro' }));
            return output.trim() === '';
        },
        run: (context) => exec('sudo', ['chown', '-R', `${user}:${user}`, context.projectDir], { interactive: true }),
    };

    const configureShell = {
        title: 'Configurar o comando nx no shell',
        skip: async (context) => {
            const rcFile = await chooseRcFile({ home, shell });
            return await exists(rcFile) && (await readFile(rcFile, 'utf8')).includes(renderBlock(context.projectDir));
        },
        run: async (context) => {
            const rcFile = await chooseRcFile({ home, shell });
            const current = await exists(rcFile) ? await readFile(rcFile, 'utf8') : '';
            await writeFile(rcFile, upsertBlock(current, renderBlock(context.projectDir)));
            context.rcFile = rcFile;
        },
    };

    const checkNxCommand = {
        title: 'Verificar o executavel nx',
        optional: true,
        run: async (context) => {
            if (!await exists(join(context.projectDir, 'nx'))) {
                throw new Error(`Executavel "nx" nao encontrado em ${context.projectDir}.`);
            }
        },
    };

    return [
        chooseDirectory, installGit, installDocker, addUserToDockerGroup, installPnpm,
        generateSshKey, authorizeSshKey, cloneRepository, fixOwnership, configureShell, checkNxCommand,
    ];
}
