export const REPO_URL = 'git@bitbucket.org:devsmartnx/nx-suite-docker.git';
export const REPO_DIR_NAME = 'nx-suite-docker';
export const DEFAULT_PARENT_DIR_NAME = 'snx';

export const BITBUCKET_SSH_KEYS_URL = 'https://bitbucket.org/account/settings/ssh-keys/';
export const SSH_KEY_FILE = 'id_ed25519';

/** Evita prompt de "authenticity of host" e de senha: a verificacao nunca fica esperando input. */
export const GIT_SSH_ENV = {
    GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
    GIT_TERMINAL_PROMPT: '0',
};

export const BLOCK_START = '# >>> nx-suite (setup-pipelines) >>>';
export const BLOCK_END = '# <<< nx-suite (setup-pipelines) <<<';

const DOCKER_KEYRING = '/etc/apt/keyrings/docker.gpg';
const DOCKER_REPO_LINE = `echo "deb [arch=$(dpkg --print-architecture) signed-by=${DOCKER_KEYRING}] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`;

/** Instalacao do Docker no Ubuntu, conforme https://devdocs.smartnx.io/docs/backend/ferramentas/docker */
export const DOCKER_INSTALL_COMMANDS = [
    ['sudo', ['apt-get', 'update', '-qq']],
    ['sudo', ['apt-get', 'install', '-y', 'apt-transport-https', 'ca-certificates', 'curl', 'software-properties-common', 'gnupg']],
    ['sudo', ['install', '-m', '0755', '-d', '/etc/apt/keyrings']],
    ['sh', ['-c', `curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o ${DOCKER_KEYRING}`]],
    ['sh', ['-c', DOCKER_REPO_LINE]],
    ['sudo', ['apt-get', 'update', '-qq']],
    ['sudo', ['apt-get', 'install', '-y', 'docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-compose']],
];
