import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseRcFile, renderBlock, upsertBlock } from '../src/rc.js';

let home;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'suite-rc-')); });
afterEach(() => rm(home, { recursive: true, force: true }));

test('renderBlock exporta NXTOOLKITBASEPATH e adiciona o diretorio ao PATH', () => {
    const block = renderBlock('/x/nx-suite-docker');
    assert.match(block, /export NXTOOLKITBASEPATH="\/x\/nx-suite-docker"/);
    assert.match(block, /export PATH="\$PATH:\/x\/nx-suite-docker"/);
});

test('upsertBlock acrescenta ao final, com ou sem quebra de linha previa', () => {
    assert.equal(upsertBlock('', 'BLOCO'), '\nBLOCO\n');
    assert.equal(upsertBlock('a\n', 'BLOCO'), 'a\n\nBLOCO\n');
    assert.equal(upsertBlock('a', 'BLOCO'), 'a\n\nBLOCO\n');
});

test('upsertBlock substitui o bloco anterior e preserva o resto', () => {
    const first = upsertBlock('antes\n', renderBlock('/velho'));
    const content = `${first}depois\n`;

    const updated = upsertBlock(content, renderBlock('/novo'));

    assert.ok(updated.startsWith('antes\n'));
    assert.ok(updated.endsWith('depois\n'));
    assert.ok(updated.includes('"/novo"'));
    assert.ok(!updated.includes('"/velho"'));
});

test('upsertBlock e idempotente', () => {
    const once = upsertBlock('x\n', renderBlock('/a'));
    assert.equal(upsertBlock(once, renderBlock('/a')), once);
});

test('chooseRcFile: bash usa .bashrc', async () => {
    assert.equal(await chooseRcFile({ home, shell: '/bin/bash' }), join(home, '.bashrc'));
});

test('chooseRcFile: zsh usa .zshrc.local quando o .zshrc o carrega', async () => {
    await writeFile(join(home, '.zshrc'), '[ -f ~/.zshrc.local ] && . ~/.zshrc.local\n');
    assert.equal(await chooseRcFile({ home, shell: '/usr/bin/zsh' }), join(home, '.zshrc.local'));
});

test('chooseRcFile: zsh usa .zshrc quando ele nao carrega o .local ou nao existe', async () => {
    assert.equal(await chooseRcFile({ home, shell: '/usr/bin/zsh' }), join(home, '.zshrc'));
    await writeFile(join(home, '.zshrc'), 'export A=1\n');
    assert.equal(await chooseRcFile({ home, shell: '/usr/bin/zsh' }), join(home, '.zshrc'));
});
