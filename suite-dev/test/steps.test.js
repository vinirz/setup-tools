import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSteps } from '../src/steps.js';
import { DOCKER_INSTALL_COMMANDS, GIT_SSH_ENV, REPO_URL } from '../src/config.js';
import { renderBlock } from '../src/rc.js';

const USER = 'dev';
let home;
let calls;

/** Executor falso: `handler(comando, args)` devolve a saida ou lanca para simular falha. */
const fakeExec = (handler = () => '') => async (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    return { output: await handler(command, args, options) ?? '' };
};

function fakeUi({ confirmations = [], textAnswer = '' } = {}) {
    const events = [];
    const queue = [...confirmations];
    return {
        events,
        note: (message) => events.push(`note:${message}`),
        info: (message) => events.push(`info:${message}`),
        success: (message) => events.push(`success:${message}`),
        warn: (message) => events.push(`warn:${message}`),
        confirm: async () => queue.shift() ?? false,
        text: async (message, initial) => { events.push(`text:${initial}`); return textAnswer || initial; },
    };
}

const stepsWith = (options = {}) => createSteps({ home, user: USER, shell: '/bin/bash', exec: fakeExec(), ...options });
const find = (steps, text) => steps.find((step) => step.title.includes(text));
const commands = () => calls.map(({ command, args }) => [command, ...args].join(' '));
const failing = (message = 'falhou') => () => { throw new Error(message); };

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'suite-dev-'));
    calls = [];
});
afterEach(() => rm(home, { recursive: true, force: true }));

test('a ordem das etapas segue o fluxo combinado', () => {
    const titles = stepsWith().map((step) => step.title);
    const order = ['diretorio', 'git', 'Docker', 'grupo docker', 'pnpm', 'Gerar a chave', 'Autorizar', 'Clonar', 'chown', 'nx no shell', 'executavel nx'];
    const positions = order.map((text) => titles.findIndex((title) => title.includes(text)));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('diretorio: pergunta com padrao em ~/snx e define o projectDir', async () => {
    const ui = fakeUi();
    const context = { ui };
    await find(stepsWith(), 'diretorio').run(context);
    assert.equal(context.projectDir, join(home, 'snx', 'nx-suite-docker'));
    assert.ok(ui.events.includes(`text:${join(home, 'snx')}`));
});

test('diretorio: expande ~ e nao pergunta quando parentDir e informado', async () => {
    const asked = { ui: fakeUi({ textAnswer: '~/trabalho' }) };
    await find(stepsWith(), 'diretorio').run(asked);
    assert.equal(asked.projectDir, join(home, 'trabalho', 'nx-suite-docker'));

    const ui = fakeUi();
    const injected = { ui };
    await find(stepsWith({ parentDir: '/srv/dev' }), 'diretorio').run(injected);
    assert.equal(injected.projectDir, '/srv/dev/nx-suite-docker');
    assert.ok(!ui.events.some((event) => event.startsWith('text:')));
});

test('git: pula quando instalado; senao atualiza o apt e instala', async () => {
    assert.equal(await find(stepsWith(), 'git').skip(), true);

    const steps = stepsWith({ exec: fakeExec(failing()) });
    assert.equal(await find(steps, 'git').skip(), false);
    calls = [];
    await find(stepsWith(), 'git').run();
    assert.deepEqual(commands(), ['sudo apt-get update -qq', 'sudo apt-get install -y git']);
});

test('docker: recusa sistemas que nao sao Ubuntu', async () => {
    const steps = stepsWith({ exec: fakeExec(() => 'debian') });
    await assert.rejects(find(steps, 'Instalar o Docker').run(), /so suporta Ubuntu/);
    assert.equal(calls.length, 1);
});

test('docker: no Ubuntu executa todos os comandos do tutorial, em ordem e interativos', async () => {
    const steps = stepsWith({ exec: fakeExec((command) => (command === 'sh' && calls.length === 1 ? 'ubuntu' : '')) });

    await find(steps, 'Instalar o Docker').run();

    assert.equal(calls.length, 1 + DOCKER_INSTALL_COMMANDS.length);
    DOCKER_INSTALL_COMMANDS.forEach(([command, args], index) => {
        assert.equal(calls[index + 1].command, command);
        assert.deepEqual(calls[index + 1].args, args);
        assert.equal(calls[index + 1].options.interactive, true);
    });
    assert.ok(commands().some((line) => line.includes('docker-ce docker-ce-cli containerd.io docker-compose')));
});

test('grupo docker: pula se o usuario ja pertence; senao adiciona e registra no contexto', async () => {
    const member = stepsWith({ exec: fakeExec(() => `${USER} sudo docker`) });
    assert.equal(await find(member, 'grupo docker').skip(), true);

    const steps = stepsWith({ exec: fakeExec(() => `${USER} sudo`) });
    assert.equal(await find(steps, 'grupo docker').skip(), false);
    const context = {};
    await find(steps, 'grupo docker').run(context);
    assert.equal(commands().at(-1), `sudo usermod -aG docker ${USER}`);
    assert.equal(context.dockerGroupAdded, true);
});

test('pnpm: pula quando instalado; senao instala globalmente com npm', async () => {
    assert.equal(await find(stepsWith(), 'pnpm').skip(), true);
    await find(stepsWith(), 'pnpm').run();
    assert.equal(commands().at(-1), 'npm install -g pnpm');
});

test('chave SSH: pula se existir; senao gera ed25519 sem passphrase', async () => {
    const step = find(stepsWith({ hostname: 'maquina' }), 'Gerar a chave');
    assert.equal(await step.skip(), false);

    await step.run();

    const keyPath = join(home, '.ssh', 'id_ed25519');
    assert.deepEqual(calls.at(-1).args, ['-t', 'ed25519', '-C', `${USER}@maquina`, '-f', keyPath, '-N', '']);
    await writeFile(keyPath, 'x');
    assert.equal(await step.skip(), true);
});

test('autorizacao: pula quando ja ha acesso ao repositorio', async () => {
    const step = find(stepsWith(), 'Autorizar');
    assert.equal(await step.skip(), true);
    assert.equal(calls[0].args.join(' '), `ls-remote ${REPO_URL} HEAD`);
    assert.deepEqual(calls[0].options.env, GIT_SSH_ENV);
});

async function writePublicKey() {
    await mkdir(join(home, '.ssh'), { recursive: true });
    await writeFile(join(home, '.ssh', 'id_ed25519.pub'), 'ssh-ed25519 AAAA dev@maquina\n');
}

test('autorizacao: mostra a chave publica e tenta de novo ate ter acesso', async () => {
    await writePublicKey();
    let attempts = 0;
    const steps = stepsWith({ exec: fakeExec(() => { if (++attempts < 2) throw new Error('denied'); }) });
    const ui = fakeUi({ confirmations: [true, true] });

    await find(steps, 'Autorizar').run({ ui });

    assert.ok(ui.events.some((event) => event.startsWith('note:ssh-ed25519 AAAA')));
    assert.equal(ui.events.filter((event) => event.startsWith('warn:')).length, 1);
    assert.ok(ui.events.some((event) => event.startsWith('success:')));
});

test('autorizacao: falha com mensagem clara quando o usuario desiste', async () => {
    await writePublicKey();
    const steps = stepsWith({ exec: fakeExec(failing('denied')) });
    const ui = fakeUi({ confirmations: [true, false] });

    await assert.rejects(find(steps, 'Autorizar').run({ ui }), /Verificacao cancelada/);
    assert.equal(ui.events.filter((event) => event.startsWith('warn:')).length, 1);
});

test('clone: pula quando ja existe .git; senao clona a URL SSH no destino', async () => {
    const projectDir = join(home, 'snx', 'nx-suite-docker');
    const step = find(stepsWith(), 'Clonar');
    assert.equal(await step.skip({ projectDir }), false);

    await step.run({ projectDir });

    assert.equal(commands().at(-1), `git clone ${REPO_URL} ${projectDir}`);
    await mkdir(join(projectDir, '.git'), { recursive: true });
    assert.equal(await step.skip({ projectDir }), true);
});

test('chown: pula quando todos os arquivos ja sao do usuario', async () => {
    const step = find(stepsWith({ exec: fakeExec(() => '') }), 'chown');
    assert.equal(await step.skip({ projectDir: '/p' }), true);
    assert.deepEqual(calls[0].args, ['/p', '!', '-user', USER, '-print', '-quit']);
});

test('chown: executa quando ha arquivos de outro dono ou o find falha', async () => {
    const other = find(stepsWith({ exec: fakeExec(() => '/p/arquivo') }), 'chown');
    assert.equal(await other.skip({ projectDir: '/p' }), false);

    const broken = find(stepsWith({ exec: fakeExec(failing()) }), 'chown');
    assert.equal(await broken.skip({ projectDir: '/p' }), false);

    calls = [];
    await other.run({ projectDir: '/p' });
    assert.equal(commands()[0], `sudo chown -R ${USER}:${USER} /p`);
});

test('shell: grava o bloco no .bashrc, e depois pula (idempotente)', async () => {
    const step = find(stepsWith(), 'nx no shell');
    const context = { projectDir: '/x/nx-suite-docker' };
    assert.equal(await step.skip(context), false);

    await step.run(context);

    const bashrc = await readFile(join(home, '.bashrc'), 'utf8');
    assert.ok(bashrc.includes(renderBlock('/x/nx-suite-docker')));
    assert.equal(await step.skip(context), true);
});

test('shell: atualiza o bloco quando o diretorio muda, sem duplicar', async () => {
    const step = find(stepsWith(), 'nx no shell');
    await step.run({ projectDir: '/velho' });
    await step.run({ projectDir: '/novo' });

    const bashrc = await readFile(join(home, '.bashrc'), 'utf8');
    assert.equal(bashrc.split('NXTOOLKITBASEPATH').length - 1, 1);
    assert.ok(bashrc.includes('"/novo"') && !bashrc.includes('"/velho"'));
});

test('shell: no zsh grava em ~/.zshrc.local quando o .zshrc o carrega', async () => {
    await writeFile(join(home, '.zshrc'), '. ~/.zshrc.local\n');
    const step = find(stepsWith({ shell: '/usr/bin/zsh' }), 'nx no shell');
    const context = { projectDir: '/p' };

    await step.run(context);

    assert.equal(context.rcFile, join(home, '.zshrc.local'));
    assert.ok((await readFile(join(home, '.zshrc.local'), 'utf8')).includes('NXTOOLKITBASEPATH'));
});

test('verificacao do nx: e opcional e falha quando o executavel nao existe', async () => {
    const step = find(stepsWith(), 'executavel nx');
    assert.equal(step.optional, true);
    const projectDir = join(home, 'p');
    await mkdir(projectDir);
    await assert.rejects(step.run({ projectDir }), /nao encontrado/);
    await writeFile(join(projectDir, 'nx'), '#!/bin/sh');
    await step.run({ projectDir });
});
