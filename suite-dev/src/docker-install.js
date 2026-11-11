export const DOCKER_PACKAGES = ['docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin'];
export const FALLBACK_CODENAME = 'noble'; // Ubuntu 24.04: a Docker pode nao publicar pacotes para releases novas

const KEYRING_DIR = '/etc/apt/keyrings';
const KEYRING_FILE = `${KEYRING_DIR}/docker.asc`;

/** Comandos de instalacao do Docker Engine pelo repositorio oficial (Ubuntu/Debian). */
export function dockerInstallCommands({ distro = 'ubuntu', codename, arch }) {
    const baseUrl = `https://download.docker.com/linux/${distro}`;
    const repoLine = `deb [arch=${arch} signed-by=${KEYRING_FILE}] ${baseUrl} ${codename} stable`;
    return [
        ['sudo', ['install', '-m', '0755', '-d', KEYRING_DIR]],
        ['sudo', ['curl', '-fsSL', `${baseUrl}/gpg`, '-o', KEYRING_FILE]],
        ['sudo', ['chmod', 'a+r', KEYRING_FILE]],
        ['sh', ['-c', `echo "${repoLine}" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null`]],
        ['sudo', ['apt-get', 'update']],
        ['sudo', ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', ...DOCKER_PACKAGES]],
    ];
}

/** URL usada para saber se a Docker publica pacotes para o codinome. */
export const dockerReleaseUrl = (distro, codename) => `https://download.docker.com/linux/${distro}/dists/${codename}/Release`;
