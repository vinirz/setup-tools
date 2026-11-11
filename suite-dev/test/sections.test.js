import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Stop } from '../../common/tui/src/index.js';
import { ambienteItems } from '../src/sections/ambiente.js';
import { dockerGroupState, dockerItems } from '../src/sections/docker.js';
import { gitItems } from '../src/sections/git.js';
import { hostsItems } from '../src/sections/hosts.js';
import { expectedPnpm, nodeItems } from '../src/sections/node.js';
import { pacotesItem } from '../src/sections/pacotes.js';
import { posItems } from '../src/sections/pos.js';
import { repoItems } from '../src/sections/repo.js';
import { setupItems } from '../src/sections/setup.js';
import { sshItems } from '../src/sections/ssh.js';
import { SECTIONS } from '../src/sections/index.js';
import { commandError, fakeUi, lines, makeCtx } from './helpers.js';

const byLabel = (items, text) => (Array.isArray(items) ? items : Object.values(items)).find((item) => item.label.includes(text));

test('a ordem das secoes segue o fluxo do script', () => {
    assert.deepEqual(SECTIONS.map((section) => section.title.split(' ')[0]), [
        'Ambiente:', 'Pacotes', 'Git', 'Chave', 'Docker', 'Node.js', 'Ferramentas', 'Repositorio', 'Setup', 'Verificacao',
    ]);
});

// ---------- ambiente ----------
test('ambiente: systemd ausente no WSL grava /etc/wsl.conf e pede para reiniciar o WSL', async () => {
    const { ctx, calls } = await makeCtx();
    ctx.fileExists = async () => false; // nao depende do systemd nem do /etc/wsl.conf reais desta maquina
    ctx.readText = async () => '';
    const item = byLabel(ambienteItems(ctx), 'systemd');
    assert.equal((await item.check()).ok, false);

    await assert.rejects(item.fix(), (error) => error instanceof Stop && /Reinicie o WSL/.test(error.message));
    assert.ok(lines(calls).some((line) => line.startsWith('sudo install -m 0644')));
});

test('ambiente: fora do WSL o systemd nao tem correcao automatica', async () => {
    const { ctx } = await makeCtx({ platform: { isWsl: false, wslVersion: 0 } });
    assert.equal(byLabel(ambienteItems(ctx), 'systemd').fix, undefined);
});

test('ambiente: recusa root, WSL1 e sistemas que nao sao Debian/Ubuntu', async () => {
    const root = await makeCtx({ uid: 0 });
    assert.equal((await byLabel(ambienteItems(root.ctx), 'nao e root').check()).ok, false);

    const wsl1 = await makeCtx({ platform: { wslVersion: 1 } });
    assert.match((await byLabel(ambienteItems(wsl1.ctx), 'WSL2').check()).why, /WSL1/);

    const fedora = await makeCtx({ platform: { osId: 'fedora', osLike: 'rhel', prettyName: 'Fedora' } });
    assert.equal((await byLabel(ambienteItems(fedora.ctx), 'Sistema operacional').check()).ok, false);
});

test('ambiente: internet lista os sites inacessiveis; disco e memoria usam os minimos', async () => {
    const down = await makeCtx({ handler: (command, args) => { if (command === 'curl' && args.includes('https://nodejs.org')) throw commandError(); } });
    const internet = await byLabel(ambienteItems(down.ctx), 'internet').check();
    assert.equal(internet.ok, false);
    assert.match(internet.why, /nodejs\.org/);

    const small = await makeCtx({ handler: (command) => (command === 'df' ? 'Avail\n 10G\n' : command === 'free' ? 'Mem:  4  1' : '') });
    assert.equal((await byLabel(ambienteItems(small.ctx), 'Espaco').check()).ok, false);
    assert.equal((await byLabel(ambienteItems(small.ctx), 'Memoria').check()).ok, false);

    const ok = await makeCtx({ handler: (command) => (command === 'df' ? 'Avail\n 900G\n' : command === 'free' ? 'Mem:  7  1' : '') });
    assert.equal((await byLabel(ambienteItems(ok.ctx), 'Memoria').check()).ok, true); // 7 GB conta como 8
});

// ---------- pacotes / git ----------
test('pacotes: lista o que falta e instala em lote (com fallback um a um)', async () => {
    const { ctx, calls } = await makeCtx({
        handler: (command, args) => {
            if (command === 'dpkg' && ['zip', 'jq'].includes(args[1])) throw commandError();
            if (command === 'sudo' && args.includes('install') && args.includes('jq') && args.includes('zip')) throw commandError('lote falhou');
        },
    });
    const item = pacotesItem(ctx);
    assert.match((await item.check()).why, /faltam: zip jq/);

    await item.fix();

    const installs = lines(calls).filter((line) => line.includes('apt-get install'));
    assert.equal(installs.length, 3); // lote + zip + jq
    assert.ok(installs[1].endsWith(' zip') && installs[2].endsWith(' jq'));
});

test('git: identidade pergunta nome e e-mail e grava no git global', async () => {
    const ui = fakeUi({ texts: ['Ana Dev', 'ana@empresa.com'] });
    const { ctx, calls } = await makeCtx({ ui, handler: (command, args) => { if (command === 'git' && args[0] === 'config' && args[1] === '--global' && args.length === 3) return ''; } });
    const item = gitItems(ctx).identity;
    assert.equal((await item.check()).ok, false);

    await item.fix();

    assert.ok(lines(calls).includes('git config --global user.name Ana Dev'));
    assert.ok(lines(calls).includes('git config --global user.email ana@empresa.com'));
});

test('git: identidade nao grava sem nome/e-mail e nao pergunta sem terminal', async () => {
    const empty = await makeCtx({ ui: fakeUi({ texts: ['', ''] }) });
    assert.equal(await gitItems(empty.ctx).identity.fix(), false);

    const headless = await makeCtx({ ui: fakeUi({ interactive: false }) });
    assert.equal(await gitItems(headless.ctx).identity.fix(), false);
});

test('git: autocrlf aceita input/false e corrige o resto', async () => {
    const good = await makeCtx({ handler: () => 'input' });
    assert.equal((await gitItems(good.ctx).autocrlf.check()).ok, true);
    const bad = await makeCtx({ handler: () => 'true' });
    assert.equal((await gitItems(bad.ctx).autocrlf.check()).ok, false);
});

// ---------- ssh ----------
test('ssh: reconhece autenticacao do Bitbucket, passphrase e falhas', async () => {
    const make = (output) => makeCtx({ handler: (command) => { if (command === 'ssh') throw commandError(output); } });
    const ok = await make('authenticated via ssh key.');
    assert.equal((await sshItems(ok.ctx).bitbucket.check()).ok, true);
    const pass = await make('Enter passphrase for key');
    assert.match((await sshItems(pass.ctx).bitbucket.check()).why, /passphrase/);
    const denied = await make('git@bitbucket.org: Permission denied (publickey).');
    assert.match((await sshItems(denied.ctx).bitbucket.check()).why, /Permission denied/);
});

test('ssh: github e opcional e extrai o usuario; acesso ao repo conta as branches', async () => {
    const github = await makeCtx({ handler: (command) => { if (command === 'ssh') throw commandError("Hi vinirz! You've successfully authenticated"); } });
    const item = sshItems(github.ctx).github;
    assert.equal(item.level, 'optional');
    assert.equal((await item.check()).detail, 'Hi vinirz');

    const repo = await makeCtx({ handler: () => 'abc\trefs/heads/main\ndef\trefs/heads/develop\n' });
    assert.match((await sshItems(repo.ctx).repo.check()).detail, /^2 branches/);
    const noAccess = await makeCtx({ handler: (command) => { if (command === 'git') throw commandError('Permission denied'); } });
    assert.equal((await sshItems(noAccess.ctx).repo.check()).ok, false);
});

test('ssh: encontra a chave, corrige a permissao e gera uma nova de forma interativa', async () => {
    const { ctx, calls, home } = await makeCtx({ handler: (command) => (command === 'stat' ? '644' : '') });
    const item = sshItems(ctx).key;
    assert.equal((await item.check()).ok, false);

    await mkdir(join(home, '.ssh'));
    await writeFile(join(home, '.ssh', 'id_ed25519'), 'privada');
    const result = await item.check();
    assert.match(result.detail, /permissao corrigida para 600/);
    assert.ok(lines(calls).includes(`chmod 600 ${join(home, '.ssh', 'id_ed25519')}`));

    const fresh = await makeCtx({ ui: fakeUi({ texts: ['a@b.com'] }), handler: (command, args) => (command === 'git' && args.includes('user.email') ? '' : '') });
    await sshItems(fresh.ctx).key.fix();
    const keygen = fresh.calls.find((call) => call.command === 'ssh-keygen');
    assert.deepEqual(keygen.args.slice(0, 4), ['-t', 'ed25519', '-C', 'a@b.com']);
    assert.equal(keygen.opts.interactive, true);
});

// ---------- docker ----------
test('docker: estado do grupo (effective, pending, absent)', async () => {
    const effective = await makeCtx({ handler: (command) => (command === 'id' ? 'dev sudo docker' : '') });
    assert.equal(await dockerGroupState(effective.ctx), 'effective');
    const pending = await makeCtx({ handler: (command) => (command === 'id' ? 'dev sudo' : command === 'getent' ? 'docker:x:989:dev' : '') });
    assert.equal(await dockerGroupState(pending.ctx), 'pending');
    const absent = await makeCtx({ handler: (command) => (command === 'id' ? 'dev sudo' : command === 'getent' ? 'docker:x:989:' : '') });
    assert.equal(await dockerGroupState(absent.ctx), 'absent');
});

test('docker: fora do grupo adiciona o usuario e passa a usar sg docker', async () => {
    const { ctx, calls } = await makeCtx({ handler: (command) => (command === 'id' ? 'dev sudo' : command === 'getent' ? 'docker:x:989:' : '') });
    const result = await dockerItems(ctx).group.fix();
    assert.equal(result, false);
    assert.equal(ctx.dockerViaSg, true);
    assert.ok(lines(calls).includes('sudo usermod -aG docker dev'));
});

test('docker: daemon so acessivel via sg docker liga o modo sg e dk passa a usar sg', async () => {
    const { ctx, calls } = await makeCtx({ handler: (command) => { if (command === 'docker') throw commandError('permission denied'); } });
    const result = await dockerItems(ctx).daemon.check();
    assert.equal(result.ok, true);
    assert.equal(ctx.dockerViaSg, true);

    calls.length = 0;
    await ctx.dk(['ps']);
    assert.equal(calls[0].command, 'sg');
    assert.equal(calls[0].args[2], "'docker' 'ps'");
});

test('docker: instalacao usa o codinome publicado, ou o fallback, e inclui os plugins', async () => {
    const published = await makeCtx({ handler: (command) => (command === 'dpkg' ? 'amd64' : '') });
    await dockerItems(published.ctx).installed.fix();
    const repo = lines(published.calls).find((line) => line.includes('docker.list'));
    assert.match(repo, /ubuntu noble stable/);
    assert.ok(lines(published.calls).at(-1).includes('docker-buildx-plugin docker-compose-plugin'));

    const future = await makeCtx({
        platform: { codename: 'zeta' },
        handler: (command, args) => { if (command === 'curl' && args.some((arg) => arg.includes('/dists/zeta/'))) throw commandError(); },
    });
    await dockerItems(future.ctx).installed.fix();
    assert.match(lines(future.calls).find((line) => line.includes('docker.list')), /ubuntu noble stable/);
});

test('docker: plugins compose e buildx sao instalados pelo apt quando faltam', async () => {
    const { ctx, calls } = await makeCtx({ handler: (command, args) => { if (command === 'docker' && ['compose', 'buildx'].includes(args[0])) throw commandError(); } });
    const items = dockerItems(ctx);
    assert.equal((await items.compose.check()).ok, false);
    assert.equal((await items.buildx.check()).ok, false);
    await items.compose.fix();
    await items.buildx.fix();
    assert.ok(lines(calls).includes('sudo apt-get install -y docker-compose-plugin'));
    assert.ok(lines(calls).includes('sudo apt-get install -y docker-buildx-plugin'));
});

test('docker: atalho docker-compose v1 e criado como script executavel', async () => {
    const { ctx, home } = await makeCtx({ handler: (command, args) => { if (command === 'sh' && args[1]?.includes('docker-compose')) throw commandError('', 1); } });
    const item = dockerItems(ctx).composeV1;
    assert.equal((await item.check()).ok, false);
    await item.fix();
    const shim = await readFile(join(home, '.local', 'bin', 'docker-compose'), 'utf8');
    assert.match(shim, /exec docker compose "\$@"/);
});

// ---------- node ----------
test('node: exige a versao 24, tanto a ativa quanto o padrao do nvm', async () => {
    const make = (output) => makeCtx({ handler: () => output });
    assert.equal((await nodeItems((await make('v24.18.0\n11.16.0\nv24.18.0')).ctx).node.check()).ok, true);
    assert.match((await nodeItems((await make('v26.13.0\n11.20.0\nv26.13.0')).ctx).node.check()).why, /exige Node 24/);
    assert.match((await nodeItems((await make('v24.18.0\n11.16.0\nv22.23.1')).ctx).node.check()).why, /padrao do nvm/);
    assert.match((await nodeItems((await make('')).ctx).node.check()).why, /nao instalado/);
});

test('node: instala e fixa o 24 como padrao pelo nvm', async () => {
    const { ctx, calls } = await makeCtx();
    await nodeItems(ctx).node.fix();
    assert.match(calls[0].args[1], /nvm install 24 && nvm alias default 24 && nvm use 24/);
    assert.equal(calls[0].opts.stream, true);
});

test('node: pnpm segue o packageManager do fullbackend; sem o repo usa o padrao', async () => {
    const { ctx, calls } = await makeCtx();
    assert.equal(await expectedPnpm(ctx), '12.3.4');

    const fullbackend = join(ctx.nxDir, 'sources', 'nx-suite-fullbackend');
    await mkdir(fullbackend, { recursive: true });
    await writeFile(join(fullbackend, 'package.json'), JSON.stringify({ packageManager: 'pnpm@13.0.1+sha512.abc' }));
    assert.equal(await expectedPnpm(ctx), '13.0.1');

    await nodeItems(ctx).pnpm.fix();
    assert.match(calls.at(-1).args[1], /npm install -g pnpm@13\.0\.1/);
});

test('node: pm2 e obrigatorio, yarn e opcional', async () => {
    const { ctx } = await makeCtx();
    const items = nodeItems(ctx);
    assert.equal(items.pm2.level, 'required');
    assert.equal(items.yarn.level, 'optional');
});

// ---------- repo ----------
test('repo: clona por SSH, recusa pasta nao vazia e respeita --skip-repos', async () => {
    const { ctx, calls } = await makeCtx();
    await repoItems(ctx).cloned.fix();
    assert.ok(lines(calls).includes(`git clone git@bitbucket.org:devsmartnx/nx-suite-docker.git ${ctx.nxDir}`));

    const busy = await makeCtx({ handler: (command) => (command === 'ls' ? 'arquivo' : '') });
    assert.equal(await repoItems(busy.ctx).cloned.fix(), false);
    assert.ok(busy.calls.every((call) => call.command !== 'git'));

    const skipped = await makeCtx({ options: { skipRepos: true } });
    assert.equal(await repoItems(skipped.ctx).cloned.fix(), false);
});

test('repo: pasta inexistente nao e tratada como "nao vazia" (o erro do ls nao conta)', async () => {
    const { ctx, calls } = await makeCtx({ handler: (command) => { if (command === 'ls') throw commandError("ls: cannot access '/x': No such file or directory"); } });
    const item = repoItems(ctx).cloned;
    assert.match((await item.check()).why, /nao clonado/);
    assert.equal(await item.fix(), true);
    assert.ok(lines(calls).some((line) => line.startsWith('git clone ')));
});

test('repo: shell grava o bloco do nx no principal e no .bashrc, com backup, de forma idempotente', async () => {
    const { ctx, home } = await makeCtx();
    await writeFile(join(home, '.zshrc'), '[ -f ~/.zshrc.local ] && . ~/.zshrc.local\n');
    await writeFile(join(home, '.zshrc.local'), 'export A=1\n');
    const item = repoItems(ctx).shell;
    assert.equal((await item.check()).ok, false);

    await item.fix();
    await item.fix();

    const local = await readFile(join(home, '.zshrc.local'), 'utf8');
    assert.equal(local.split('NXTOOLKITBASEPATH="').length - 1, 1);
    assert.ok(local.startsWith('export A=1'));
    assert.match(await readFile(join(home, '.bashrc'), 'utf8'), /NXTOOLKITBASEPATH/);
    assert.ok((await readdir(home)).some((name) => name.startsWith('.zshrc.local.bak-nx-')));
    assert.equal((await item.check()).ok, true);
});

test('repo: shell nao sobrescreve um NXTOOLKITBASEPATH definido por voce em outro lugar', async () => {
    const { ctx, home } = await makeCtx({ shell: '/bin/bash' });
    await writeFile(join(home, '.bashrc'), 'export NXTOOLKITBASEPATH=/meu/caminho\n');
    const item = repoItems(ctx).shell;
    assert.match((await item.check()).why, /aponta para "\/meu\/caminho"/);

    await item.fix();

    assert.equal(await readFile(join(home, '.bashrc'), 'utf8'), 'export NXTOOLKITBASEPATH=/meu/caminho\n');
    assert.ok(ctx.ui.events.some((event) => event.startsWith('info:') && event.includes('ja define NXTOOLKITBASEPATH')));
});

test('repo: dono dos arquivos pede chown so quando ha arquivo de outro dono', async () => {
    const mine = await makeCtx();
    assert.equal((await repoItems(mine.ctx).ownership.check()).ok, true);

    const other = await makeCtx({ handler: (command) => (command === 'find' ? '/p/arquivo' : '') });
    const item = repoItems(other.ctx).ownership;
    assert.equal((await item.check()).ok, false);
    await item.fix();
    assert.ok(lines(other.calls).includes(`sudo chown -R dev:dev ${other.ctx.nxDir}`));
});

test('repo: atualizacao nao faz pull com alteracoes locais', async () => {
    const dirty = await makeCtx({ handler: (command, args) => (args.includes('status') ? ' M arquivo.js' : '') });
    assert.equal(await repoItems(dirty.ctx).updated.fix(), false);
    assert.ok(dirty.calls.every((call) => !call.args.includes('pull')));

    const clean = await makeCtx();
    assert.equal(await repoItems(clean.ctx).updated.fix(), true);
    assert.ok(lines(clean.calls).some((line) => line.endsWith('pull --ff-only')));
});

// ---------- setup ----------
test('setup: so builda rabbitmq e redis e sobe os 4 containers de infraestrutura', async () => {
    const { ctx } = await makeCtx();
    const labels = setupItems(ctx).map((item) => item.label);
    assert.deepEqual(labels.filter((label) => label.startsWith('Imagem docker')), ['Imagem docker nx:docker-rabbitmq', 'Imagem docker nx:docker-redis']);
    assert.deepEqual(labels.filter((label) => label.startsWith('Container')), [
        'Container nx-suite-rabbitmq em execucao', 'Container nx-suite-nx-redis em execucao',
        'Container nx-suite-mongodb em execucao', 'Container nx-suite-postgres em execucao',
    ]);
    assert.equal(labels.at(-1), 'Banco principal carregado (dump + migrations)');
});

test('setup: nunca chama os comandos que buildam tudo ou apagam todos os containers', async () => {
    const { ctx, calls } = await makeCtx();
    for (const item of setupItems(ctx)) await item.fix?.().catch(() => {});
    const joined = lines(calls).join('\n');
    assert.doesNotMatch(joined, /build-dockers|nx setup|docker rm -f|system prune/);
    assert.match(joined, /pull-services develop/);
    assert.match(joined, /build-docker core docker-rabbitmq/);
    assert.match(joined, /build-docker core docker-redis/);
    assert.match(joined, /start postgres/);
    assert.match(joined, /load-postgres/);
});

test('setup: nx roda com NXTOOLKITBASEPATH e, com grupo pendente, dentro de sg docker', async () => {
    const plain = await makeCtx();
    await plain.ctx.nx('init-hosts');
    assert.match(plain.calls[0].args[1], /export NXTOOLKITBASEPATH=.*nx-suite-docker.*bash \.\/nx init-hosts/s);
    assert.doesNotMatch(plain.calls[0].args[1], /sg docker/);

    const grouped = await makeCtx();
    grouped.ctx.dockerViaSg = true;
    await grouped.ctx.nx('init-hosts');
    assert.match(grouped.calls[0].args[1], /^sg docker -c /);
});

test('setup: falha do nx mostra dicas e marca os problemas conhecidos das migrations', async () => {
    const { ctx } = await makeCtx({ handler: (command, args) => { if (command === 'bash' && args[1].includes('load-postgres')) throw commandError('ERROR: relation "feature_toggle" does not exist'); } });
    const item = setupItems(ctx).at(-1);
    await assert.rejects(item.fix(), /feature_toggle/);
    assert.equal(ctx.showKnownIssues, true);
    assert.ok(ctx.ui.events.some((event) => event.startsWith('guide:') && event.includes('Migrations')));
});

test('setup: saida com erro silencioso (codigo 0) tambem conta como falha', async () => {
    const { ctx } = await makeCtx({ handler: (command, args) => (command === 'bash' && args[1].includes('init-services') ? 'npm error code E404' : '') });
    const item = setupItems(ctx).find((candidate) => candidate.label.includes('Dependencias'));
    await assert.rejects(item.fix(), /terminou com erros/);
});

test('setup: banco ja carregado nao e recarregado (o load-postgres reseta o banco)', async () => {
    const loaded = await makeCtx({ handler: (command, args) => (args.includes('psql') || args.join(' ').includes('psql') ? '785\n' : '') });
    const item = setupItems(loaded.ctx).at(-1);
    assert.equal((await item.check()).ok, true);

    const empty = await makeCtx({ handler: (command, args) => { if (args.join(' ').includes('psql')) throw commandError('relation does not exist'); } });
    assert.equal((await setupItems(empty.ctx).at(-1).check()).ok, false);
});

// ---------- pos ----------
test('pos: postgres usa o teste TCP da porta 15433', async () => {
    const seen = [];
    const up = await makeCtx({ tcpOpen: async (host, port) => { seen.push([host, port]); return true; } });
    assert.equal((await posItems(up.ctx).postgres.check()).ok, true);
    assert.deepEqual(seen, [['127.0.0.1', 15433]]);
    const down = await makeCtx({ tcpOpen: async () => false });
    assert.equal((await posItems(down.ctx).postgres.check()).ok, false);
});

test('pos: migrations compara aplicadas com os arquivos e marca os problemas conhecidos', async () => {
    const { ctx } = await makeCtx({ handler: () => '2\n' });
    const folder = join(ctx.nxDir, 'sources', 'nx-suite-fullbackend', 'migrations', 'main');
    await mkdir(folder, { recursive: true });
    for (const name of ['1_a.js', '2_b.js', '3_c.js']) await writeFile(join(folder, name), '');

    const result = await posItems(ctx).migrations.check();

    assert.match(result.why, /apenas 2 de 3/);
    assert.equal(ctx.showKnownIssues, true);
});

test('pos: arquivos .env faltantes sao listados so para projetos clonados', async () => {
    const { ctx } = await makeCtx();
    await mkdir(join(ctx.nxDir, 'sources', 'nx-suite-front-novo'), { recursive: true });
    const result = await posItems(ctx).envFiles.check();
    assert.equal(result.ok, false);
    assert.match(result.why, /nx-suite-front-novo\/\.env/);
    assert.doesNotMatch(result.why, /webchat/);
});

test('pos: guia dos hosts do Windows gera o arquivo com as linhas #NXT (e nao no --check)', async () => {
    const check = await makeCtx({ options: { checkOnly: true } });
    const guide = await posItems(check.ctx).hostsWindows.guide();
    assert.match(guide.join(' '), /sem --check/);
    assert.equal((await readdir(check.home)).includes('nx-hosts-windows.txt'), false);
});

// ---------- hosts (nx init-hosts + /etc/wsl.conf) ----------
const WSL_CONF_BEFORE = '[boot]\nsystemd=true\n\n[network]\ngenerateHosts = true\n\n[interop]\nappendWindowsPath = false\n';

test('hosts: generateHosts=false e gravado em [network], trocando o valor e preservando o resto', async () => {
    const { ctx } = await makeCtx();
    ctx.readText = async () => WSL_CONF_BEFORE;
    const written = [];
    ctx.writeRootFile = async (path, content) => written.push([path, content]);
    const item = hostsItems(ctx).generateHosts;
    assert.equal((await item.check()).ok, false);

    await item.fix();

    assert.equal(written.length, 1);
    assert.equal(written[0][0], '/etc/wsl.conf');
    assert.equal(written[0][1], '[boot]\nsystemd=true\n\n[network]\ngenerateHosts=false\n\n[interop]\nappendWindowsPath = false\n');
    assert.equal(ctx.wslRestartNeeded, true);
});

test('hosts: cria a secao [network] quando ela nao existe', async () => {
    const { ctx } = await makeCtx();
    ctx.readText = async () => '[boot]\nsystemd=true\n';
    const written = [];
    ctx.writeRootFile = async (path, content) => written.push(content);
    await hostsItems(ctx).generateHosts.fix();
    assert.equal(written[0], '[boot]\nsystemd=true\n\n[network]\ngenerateHosts=false\n');
});

test('hosts: aceita generateHosts com espacos (como no seu wsl.conf) e nao reescreve', async () => {
    const { ctx } = await makeCtx();
    ctx.readText = async () => '[network]\ngenerateHosts = false\n';
    assert.equal((await hostsItems(ctx).generateHosts.check()).ok, true);
});

test('hosts: fora do WSL o generateHosts nao se aplica', async () => {
    const { ctx } = await makeCtx({ platform: { isWsl: false, wslVersion: 0 } });
    assert.equal((await hostsItems(ctx).generateHosts.check()).ok, true);
});

test('hosts: init-hosts pede o sudo antes e roda pelo nx; sem sudo nao roda', async () => {
    const { ctx, calls } = await makeCtx();
    assert.equal(await hostsItems(ctx).hostsLinux.fix(), true);
    const order = lines(calls);
    assert.ok(order.findIndex((line) => line.includes('command -v') && line.includes('sudo')) < order.findIndex((line) => line.includes('init-hosts')));
    assert.match(calls.at(-1).args[1], /bash \.\/nx init-hosts/);

    const checkOnly = await makeCtx({ options: { checkOnly: true } });
    assert.equal(await hostsItems(checkOnly.ctx).hostsLinux.fix(), false);
    assert.ok(checkOnly.calls.every((call) => !String(call.args[1] ?? '').includes('init-hosts')));
});

test('hosts: falha do init-hosts mostra as dicas', async () => {
    const { ctx } = await makeCtx({ handler: (command, args) => { if (command === 'bash' && String(args[1]).includes('init-hosts')) throw commandError('sudo: a password is required'); } });
    await assert.rejects(hostsItems(ctx).hostsLinux.fix(), /password/);
    assert.ok(ctx.ui.events.some((event) => event.startsWith('guide:')));
});

test('setup: a ordem e ENVIROMENT, wsl.conf, init-hosts e so depois os projetos', async () => {
    const { ctx } = await makeCtx();
    const labels = setupItems(ctx).map((item) => item.label);
    assert.deepEqual(labels.slice(0, 4), [
        'Arquivo ENVIROMENT', '/etc/wsl.conf com generateHosts=false', 'Hosts no Linux (/etc/hosts)', 'Projetos em sources/ clonados',
    ]);
});

test('hosts: no setup rodam com autoConfirm e antes dos containers; o generateHosts e obrigatorio', async () => {
    const { ctx } = await makeCtx();
    const item = setupItems(ctx).find((candidate) => candidate.label.startsWith('/etc/wsl.conf'));
    assert.equal(item.level, undefined); // padrao do runner: required
});
