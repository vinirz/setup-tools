export const SCRIPT_VERSION = '2.0.0';

export const NX_REPO_SSH = 'git@bitbucket.org:devsmartnx/nx-suite-docker.git';
export const NX_REPO_WEB = 'https://bitbucket.org/devsmartnx/nx-suite-docker';
export const DEFAULT_NX_DIR = 'snx/nx-suite-docker';

export const BITBUCKET_SSH_KEYS_URL = 'https://bitbucket.org/account/settings/ssh-keys/';
export const GITHUB_SSH_KEYS_URL = 'https://github.com/settings/keys';
export const SSH_KEY_NAMES = ['id_ed25519', 'id_rsa', 'id_ecdsa'];

/** Evita prompts de "authenticity of host" e de senha: a verificacao nunca fica esperando input. */
export const GIT_SSH_ENV = {
    GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
    GIT_TERMINAL_PROMPT: '0',
};

export const NODE_RECOMMENDED_MAJOR = 24; // a mesma versao dos Dockerfiles do fullbackend
export const NODE_MIN_MAJOR = 20;
export const PNPM_VERSION_DEFAULT = '12.3.4'; // o certo e o "packageManager" do fullbackend (lido depois do clone)
export const NVM_VERSION = 'v0.40.7';

export const MIN_DISK_GB = 40;
export const MIN_MEM_GB = 8;

export const INTERNET_URLS = [
    'https://github.com', 'https://bitbucket.org', 'https://registry.npmjs.org',
    'https://download.docker.com', 'https://raw.githubusercontent.com', 'https://nodejs.org',
];

export const APT_PACKAGES = [
    'ca-certificates', 'curl', 'wget', 'git', 'unzip', 'zip', 'jq', 'openssl', 'openssh-client', 'build-essential',
    'python3', 'pkg-config', 'gnupg', 'lsb-release', 'postgresql-client', 'redis-tools', 'netcat-openbsd',
];

/** Repositorios que o `nx pull-services` clona em sources/. */
export const REQUIRED_SOURCES = ['nx-suite-front-novo', 'nx-suite-fullbackend', 'nx-suite-webchat', 'nx-suite-webchat-plus'];

export const OPTIONAL_REPOS = [
    { host: 'bitbucket.org', path: 'devsmartnx/nx-suite-scripts', folder: 'nx-suite-scripts', desc: 'scripts auxiliares' },
    { host: 'bitbucket.org', path: 'devsmartnx/dev-docs', folder: 'dev-docs', desc: 'documentacao interna (Docusaurus)' },
    { host: 'github.com', path: 'infraestruturasnx/nx-suite-metrics', folder: 'nx-suite-metrics', desc: 'servico de metricas' },
    { host: 'github.com', path: 'infraestruturasnx/nxsuite-desk', folder: 'nxsuite-desk', desc: 'nxsuite desk' },
];

/** Arquivos .env que NAO ficam no git. */
export const ENV_EXPECTED = [
    { dir: 'nx-suite-front-novo', file: '.env' },
    { dir: 'nx-suite-webchat', file: '.env-local' },
    { dir: 'nx-suite-webchat-plus', file: '.env-local' },
    { dir: 'nxsuite-desk', file: '.env' },
    { dir: 'nx-suite-metrics', file: '.env' },
];

/**
 * Containers de infraestrutura que a pipeline sobe. Os demais servicos (APIs e workers) rodam pelo PM2.
 * `image` so existe para os que tem Dockerfile em lib/dockers; mongodb e postgres sobem por docker compose.
 */
export const ESSENTIAL_CONTAINERS = [
    { name: 'rabbitmq', container: 'nx-suite-rabbitmq', image: 'nx:docker-rabbitmq', coreFolder: 'docker-rabbitmq' },
    { name: 'redis', container: 'nx-suite-nx-redis', image: 'nx:docker-redis', coreFolder: 'docker-redis' },
    { name: 'mongodb', container: 'nx-suite-mongodb' },
    { name: 'postgres', container: 'nx-suite-postgres' },
];

export const POSTGRES = { container: 'nx-suite-postgres', user: 'nxsuitedev', database: 'nxsuitedev', port: 15433 };

export const WINDOWS_HOSTS_FILE = '/mnt/c/Windows/System32/drivers/etc/hosts';
export const HOSTS_MARKER = '#NXT';
export const MIN_HOSTS_ENTRIES = 5;

export const RC_BLOCK = { start: '# >>> nx-suite-docker (setup-pipelines) >>>', end: '# <<< nx-suite-docker (setup-pipelines) <<<' };
export const ALIAS_BLOCK = { start: '# >>> nx-suite-docker aliases (setup-pipelines) >>>', end: '# <<< nx-suite-docker aliases (setup-pipelines) <<<' };

/** Dicas exibidas quando uma etapa do setup falha: [padrao na saida, orientacao]. */
export const SETUP_HINTS = [
    [/Permission denied \(publickey\)|Host key verification failed/i, 'SSH: o Bitbucket recusou a chave. Confirme que ela esta cadastrada e que voce tem acesso ao workspace devsmartnx.'],
    [/permission denied while trying to connect to the .*docker/i, 'Docker: seu usuario ainda nao tem acesso ao daemon. Abra um terminal novo (grupo docker) e rode de novo.'],
    [/Cannot connect to the Docker daemon/i, 'Docker parado: sudo systemctl start docker'],
    [/pnpm n[aã]o encontrado/i, 'pnpm ausente: npm install -g pnpm, e rode a pipeline de novo.'],
    [/feature_toggle|does not exist/i, 'Migrations: veja "Problemas conhecidos das migrations" abaixo.'],
    [/duplicate key value violates unique constraint/i, 'Migrations: colisao de id (sequences). Veja "Problemas conhecidos das migrations" abaixo.'],
    [/no space left on device/i, 'Disco cheio: docker system df / docker builder prune -af, e libere espaco no Windows.'],
    [/Temporary failure in name resolution|Could not resolve host/i, 'Sem DNS/internet no WSL: veja o item "Acesso a internet" do PASSO 1.'],
];

export const KNOWN_MIGRATION_ISSUES = [
    'Se o setup parar nas migrations (nx-suite-fullbackend) NAO e problema do seu ambiente: sao bugs do repositorio em instalacao do zero (levantados em 09/2026).',
    '1) 1752940800000_add-feature-flag-new-import-contact usa a tabela feature_toggle antes de ela existir (criada pela 1755262047641).',
    '2) Onze migrations tem timestamp malformado (14/15 digitos); o node-pg-migrate as executa por ultimo, mas outras dependem delas.',
    '3) As migrations 1777308668620 e 1777377131229 inserem o mesmo id (14) em journey_component.',
    '4) O dump_main.sql zera as sequences; o load-postgres ja roda reset-sequences.sql (se o clone e antigo, faca git pull).',
    'Se isso ja foi corrigido no repositorio, ignore este aviso.',
];
