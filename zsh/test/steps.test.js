import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSteps } from '../src/steps.js';
import { renderZshrc } from '../src/render.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

let home;
let calls;

/** Executor falso: registra os comandos e responde via `responses[comando]`. */
function fakeExec(responses = {}) {
    return async (command, args = [], options = {}) => {
        calls.push({ command, args, options });
        const response = responses[command];
        if (response instanceof Error) throw response;
        return { output: response ?? '' };
    };
}

const stepsWith = (overrides = {}) => createSteps({
    home, templatesDir: TEMPLATES_DIR, exec: fakeExec(), ...overrides,
});
const findStep = (steps, text) => steps.find((step) => step.title.includes(text));
const commandsRun = () => calls.map(({ command, args }) => [command, ...args].join(' '));

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'setup-zsh-'));
    calls = [];
});
afterEach(() => rm(home, { recursive: true, force: true }));

test('renderZshrc troca os placeholders pelos glifos Nerd Font', () => {
    const rendered = renderZshrc('a=@GIT_SYMBOL@ b=@NODE_SYMBOL@');
    assert.equal(rendered, 'a=\uf418  b=\ue718 ');
});

test('o template real nao deixa placeholders depois de renderizado', async () => {
    const template = await readFile(join(TEMPLATES_DIR, 'zshrc'), 'utf8');
    assert.doesNotMatch(renderZshrc(template), /@[A-Z_]+@/);
});

test('pacotes: pula quando todos ja estao instalados', async () => {
    const step = findStep(stepsWith(), 'Instalar pacotes (');
    assert.equal(await step.skip(), true);
});

test('pacotes: nao pula quando algum falta, e instala com sudo interativo', async () => {
    const steps = stepsWith({ exec: fakeExec({ dpkg: new Error('nao instalado') }) });
    const step = findStep(steps, 'Instalar pacotes (');
    assert.equal(await step.skip(), false);

    await step.run();

    assert.deepEqual(commandsRun().slice(-2), [
        'sudo apt-get update -qq',
        'sudo apt-get install -y git curl zsh bat',
    ]);
    const sudoCalls = calls.filter((call) => call.command === 'sudo');
    assert.ok(sudoCalls.length > 0 && sudoCalls.every((call) => call.options.interactive));
});

test('pacotes opcionais sao marcados como opcionais', () => {
    assert.equal(findStep(stepsWith(), 'opcionais').optional, true);
});

test('oh-my-zsh: pula quando o diretorio existe', async () => {
    const step = findStep(stepsWith(), 'oh-my-zsh');
    assert.equal(await step.skip(), false);
    await mkdir(join(home, '.oh-my-zsh'));
    assert.equal(await step.skip(), true);
});

test('repositorios: clona quando ausente e atualiza quando ja existe', async () => {
    const step = findStep(stepsWith(), 'plugin zsh-autosuggestions');
    const target = join(home, '.oh-my-zsh/custom/plugins/zsh-autosuggestions');

    await step.run();
    assert.match(commandsRun()[0], /^git clone --depth=1 https:\/\/github.com\/zsh-users\/zsh-autosuggestions /);

    calls = [];
    await mkdir(join(target, '.git'), { recursive: true });
    await step.run();
    assert.equal(commandsRun()[0], `git -C ${target} pull --ff-only -q`);
});

test('.zshrc: faz backup do existente e escreve o renderizado', async () => {
    await writeFile(join(home, '.zshrc'), 'antigo');

    await findStep(stepsWith(), 'Escrever ~/.zshrc').run();

    const files = await readdir(home);
    const backup = files.find((name) => name.startsWith('.zshrc.backup.'));
    assert.equal(await readFile(join(home, backup), 'utf8'), 'antigo');
    const written = await readFile(join(home, '.zshrc'), 'utf8');
    assert.match(written, /ZSH_THEME="spaceship"/);
    assert.ok(written.includes('\uf418'));
});

test('.zshrc.local: nunca sobrescreve o existente', async () => {
    const step = findStep(stepsWith(), '.zshrc.local');
    await writeFile(join(home, '.zshrc.local'), 'meu');
    assert.equal(await step.skip(), true);
});

test('.zshrc.local: cria a partir do template quando ausente', async () => {
    const step = findStep(stepsWith(), '.zshrc.local');
    assert.equal(await step.skip(), false);
    await step.run();
    const template = await readFile(join(TEMPLATES_DIR, 'zshrc.local'), 'utf8');
    assert.equal(await readFile(join(home, '.zshrc.local'), 'utf8'), template);
});

test('tema: cria o link e e idempotente', async () => {
    await mkdir(join(home, '.oh-my-zsh/custom/themes/spaceship-prompt'), { recursive: true });
    const step = findStep(stepsWith(), 'Linkar');

    await step.run();
    await step.run();

    const link = join(home, '.oh-my-zsh/custom/themes/spaceship.zsh-theme');
    assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test('shell padrao: pula com --no-chsh ou quando ja e zsh', async () => {
    assert.equal(await findStep(stepsWith({ changeShell: false }), 'shell padrao').skip(), true);
    assert.equal(await findStep(stepsWith({ currentShell: '/usr/bin/zsh' }), 'shell padrao').skip(), true);
    assert.equal(await findStep(stepsWith({ currentShell: '/bin/bash' }), 'shell padrao').skip(), false);
});

test('shell padrao: usa o caminho do zsh e herda o terminal', async () => {
    const steps = stepsWith({ exec: fakeExec({ sh: '/usr/bin/zsh\n' }) });
    await findStep(steps, 'shell padrao').run();
    assert.equal(commandsRun().at(-1), 'chsh -s /usr/bin/zsh');
    assert.equal(calls.at(-1).options.interactive, true);
});

test('verificacao: falha quando o tema nao e carregado', async () => {
    const steps = stepsWith({ exec: fakeExec({ zsh: 'THEME=robbyrussell' }) });
    await assert.rejects(findStep(steps, 'Verificar').run(), /spaceship/);
});

test('verificacao: passa quando o tema spaceship e carregado', async () => {
    const steps = stepsWith({ exec: fakeExec({ zsh: 'THEME=spaceship' }) });
    await findStep(steps, 'Verificar').run();
});
