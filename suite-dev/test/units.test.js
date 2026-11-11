import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.js';
import { dockerInstallCommands, DOCKER_PACKAGES } from '../src/docker-install.js';
import { hasSilentFailure, isKnownMigrationIssue, setupHints } from '../src/hints.js';
import { hasIniOption, setIniOption } from '../src/ini.js';
import { firstLine, majorOf, parseDiskGb, parseMemoryGb } from '../src/parse.js';
import { detectPlatform, parseOsRelease } from '../src/platform.js';
import { nxState, renderAliasBlock, renderBlock, upsertBlock } from '../src/rc.js';
import { parseLxssBasePath } from '../src/wsl.js';

test('parseArgs: flags, valores e erros', () => {
    assert.deepEqual(parseArgs([]).options, {
        checkOnly: false, assumeYes: false, skipRepos: false, skipSetup: false, withOptional: false, noColor: false,
    });
    const parsed = parseArgs(['--check', '-y', '--dir', '/x', '--log', '/l.log', '--skip-setup', '--with-optional', '--skip-repos']);
    assert.deepEqual([parsed.options.checkOnly, parsed.options.assumeYes, parsed.options.skipSetup, parsed.options.withOptional, parsed.options.skipRepos], [true, true, true, true, true]);
    assert.equal(parsed.dir, '/x');
    assert.equal(parsed.log, '/l.log');
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
    assert.match(parseArgs(['--foo']).error, /desconhecida/);
    assert.match(parseArgs(['--dir']).error, /exige um valor/);
    assert.match(parseArgs(['--dir', '--check']).error, /exige um valor/);
});

test('setIniOption cria secao, substitui chave e preserva o resto', () => {
    assert.equal(setIniOption('', 'boot', 'systemd', 'true'), '[boot]\nsystemd=true\n');
    assert.equal(setIniOption('[network]\ngenerateHosts = false\n', 'boot', 'systemd', 'true'), '[network]\ngenerateHosts = false\n\n[boot]\nsystemd=true\n');
    assert.equal(setIniOption('[boot]\nsystemd=false\ncommand=x\n', 'boot', 'systemd', 'true'), '[boot]\nsystemd=true\ncommand=x\n');
    assert.equal(setIniOption('[boot]\ncommand=x\n[user]\ndefault=a\n', 'boot', 'systemd', 'true'), '[boot]\nsystemd=true\ncommand=x\n[user]\ndefault=a\n');
});

test('setIniOption e idempotente e nao mexe em chave igual de outra secao', () => {
    const once = setIniOption('[a]\nk=1\n', 'b', 'k', '2');
    assert.equal(setIniOption(once, 'b', 'k', '2'), once);
    assert.ok(once.includes('[a]\nk=1'));
});

test('hasIniOption so olha a secao pedida', () => {
    const conf = '[boot]\nsystemd=true\n[network]\ngenerateHosts=false\n';
    assert.equal(hasIniOption(conf, 'boot', 'systemd', 'true'), true);
    assert.equal(hasIniOption(conf, 'boot', 'generateHosts', 'false'), false);
    assert.equal(hasIniOption(conf, 'network', 'generateHosts', 'false'), true);
    assert.equal(hasIniOption('', 'boot', 'systemd', 'true'), false);
});

test('parse de disco, memoria, versao e primeira linha', () => {
    assert.equal(parseDiskGb('Avail\n 927G\n'), 927);
    assert.equal(parseDiskGb(''), null);
    assert.equal(parseMemoryGb('              total\nMem:             15          3\nSwap:  4 0'), 15);
    assert.equal(parseMemoryGb('nada'), null);
    assert.equal(majorOf('v24.18.0'), 24);
    assert.equal(majorOf('N/A'), 0);
    assert.equal(firstLine('\n\n  erro aqui  \noutra', 5), 'erro');
});

test('parseOsRelease e detectPlatform (WSL2, WSL1 e Linux nativo)', async () => {
    const osRelease = 'ID=ubuntu\nID_LIKE=debian\nVERSION_CODENAME=noble\nPRETTY_NAME="Ubuntu 24.04.5 LTS"\n';
    assert.deepEqual(parseOsRelease(osRelease), { osId: 'ubuntu', osLike: 'debian', codename: 'noble', prettyName: 'Ubuntu 24.04.5 LTS' });

    const read = (proc) => async (path) => (path === '/proc/version' ? proc : osRelease);
    const wsl2 = await detectPlatform({ read: read('Linux ... microsoft-standard-WSL2'), kernelRelease: '5.15-microsoft-standard-WSL2', arch: 'x64' });
    assert.deepEqual([wsl2.isWsl, wsl2.wslVersion, wsl2.arch], [true, 2, 'x86_64']);
    const wsl1 = await detectPlatform({ read: read('Linux ... Microsoft'), kernelRelease: '4.4.0-Microsoft', arch: 'x64' });
    assert.deepEqual([wsl1.isWsl, wsl1.wslVersion], [true, 1]);
    const native = await detectPlatform({ read: read('Linux version 6.8'), kernelRelease: '6.8.0-generic', arch: 'arm64' });
    assert.deepEqual([native.isWsl, native.wslVersion, native.arch], [false, 0, 'arm64']);
    const missing = await detectPlatform({ read: async () => { throw new Error('nao existe'); } });
    assert.equal(missing.osId, '');
});

test('parseLxssBasePath encontra a distro certa', () => {
    const reg = [
        'HKEY_CURRENT_USER\\...\\Lxss\\{1}', '    DistributionName    REG_SZ    Debian', '    BasePath    REG_SZ    C:\\debian',
        '', 'HKEY_CURRENT_USER\\...\\Lxss\\{2}', '    DistributionName    REG_SZ    Ubuntu', '    BasePath    REG_SZ    \\\\?\\C:\\ubuntu\r', '',
    ].join('\n');
    assert.equal(parseLxssBasePath(reg, 'Ubuntu'), '\\\\?\\C:\\ubuntu');
    assert.equal(parseLxssBasePath(reg, 'Outra'), '');
});

test('dockerInstallCommands instala o engine e os plugins compose e buildx', () => {
    const commands = dockerInstallCommands({ codename: 'noble', arch: 'amd64' });
    const install = commands.at(-1)[1];
    for (const pkg of ['docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin']) assert.ok(install.includes(pkg));
    assert.deepEqual(DOCKER_PACKAGES, install.slice(-5));
    const repoLine = commands.find(([command]) => command === 'sh')[1][1];
    assert.match(repoLine, /\[arch=amd64 signed-by=\/etc\/apt\/keyrings\/docker\.asc\] https:\/\/download\.docker\.com\/linux\/ubuntu noble stable/);
    assert.ok(dockerInstallCommands({ distro: 'debian', codename: 'bookworm', arch: 'amd64' })[1][1].join(' ').includes('/linux/debian/gpg'));
});

test('setupHints reconhece erros comuns; migrations e falhas silenciosas', () => {
    assert.equal(setupHints('Permission denied (publickey).').length, 1);
    assert.equal(setupHints('Cannot connect to the Docker daemon at unix:///var/run/docker.sock').length, 1);
    assert.deepEqual(setupHints('tudo certo'), []);
    assert.equal(isKnownMigrationIssue('relation "feature_toggle" does not exist'), true);
    assert.equal(isKnownMigrationIssue('ok'), false);
    assert.equal(hasSilentFailure('npm error code E404'), true);
    assert.equal(hasSilentFailure('Done in 2s'), false);
});

test('bloco do shell: exporta nvm, NXTOOLKITBASEPATH e PATH; upsert idempotente e atualizavel', () => {
    const block = renderBlock('/x/nx-suite-docker');
    assert.match(block, /export NXTOOLKITBASEPATH="\/x\/nx-suite-docker"/);
    assert.match(block, /\. "\$NVM_DIR\/nvm\.sh"/);
    assert.match(block, /export PATH="\$PATH:\$NXTOOLKITBASEPATH"/);

    const once = upsertBlock('antes\n', block);
    assert.equal(upsertBlock(once, block), once);
    const updated = upsertBlock(`${once}depois\n`, renderBlock('/novo'));
    assert.ok(updated.startsWith('antes\n') && updated.endsWith('depois\n'));
    assert.ok(updated.includes('"/novo"') && !updated.includes('/x/nx-suite-docker'));
    assert.equal(upsertBlock('', 'B'), '\nB\n');
    assert.equal(upsertBlock('a', 'B'), 'a\n\nB\n');
    assert.match(renderAliasBlock('/p'), /alias cdfb="cd \/p\/sources\/nx-suite-fullbackend\/"/);
});

test('nxState distingue ok, outro destino e ausente (aceita $HOME e ~)', () => {
    const dir = '/home/dev/snx/nx-suite-docker';
    assert.equal(nxState('export A=1', dir, '/home/dev').kind, 'none');
    assert.equal(nxState('export NXTOOLKITBASEPATH="$HOME/snx/nx-suite-docker"', dir, '/home/dev').kind, 'ok');
    assert.equal(nxState('export NXTOOLKITBASEPATH=~/snx/nx-suite-docker/', dir, '/home/dev').kind, 'ok');
    assert.deepEqual(nxState('export NXTOOLKITBASEPATH=/outro', dir, '/home/dev'), { kind: 'other', value: '/outro' });
    assert.equal(nxState('NXTOOLKITBASEPATH=/a\nNXTOOLKITBASEPATH=/b', '/b', '/h').kind, 'ok');
});
