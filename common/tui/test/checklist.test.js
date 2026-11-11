import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecklist, pass, fail, Stop, formatReport } from '../src/checklist.js';

/** UI falsa: registra os eventos e responde as perguntas conforme `answers`. */
function fakeUi({ confirms = [], selects = [], interactive = true } = {}) {
    const events = [];
    const confirmQueue = [...confirms];
    const selectQueue = [...selects];
    const log = (name) => (message) => events.push(`${name}:${message}`);
    return {
        events, interactive,
        intro: log('intro'), outro: log('outro'), step: log('step'), message: log('message'),
        info: log('info'), warn: log('warn'), error: log('error'), success: log('success'),
        note: (message, title) => events.push(`note:${title}`),
        guide: (lines) => events.push(`guide:${lines.join('|')}`),
        confirm: async (question) => { events.push(`confirm:${question}`); return confirmQueue.shift() ?? false; },
        select: async () => selectQueue.shift() ?? 'skip',
    };
}

const section = (run) => ({ title: 'S', run });
const names = (ui, prefix) => ui.events.filter((e) => e.startsWith(prefix));

test('item que ja esta ok e registrado como ok', async () => {
    const ui = fakeUi();
    const { exitCode, report } = await runChecklist({
        title: 'T', sections: [section((r) => r.ensure({ label: 'git', check: async () => pass('2.43') }))],
    }, ui);
    assert.equal(exitCode, 0);
    assert.deepEqual(report.ok, ['git — 2.43']);
});

test('corrige automaticamente quando o usuario aceita e verifica de novo', async () => {
    const ui = fakeUi({ confirms: [true] });
    let installed = false;
    const item = {
        label: 'git', fixDesc: 'apt',
        check: async () => (installed ? pass() : fail('ausente')),
        fix: async () => { installed = true; },
    };
    const { report, exitCode } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.deepEqual(report.fixed, ['git']);
    assert.equal(exitCode, 0);
    assert.ok(ui.events.some((e) => e.includes('(apt)')));
});

test('item obrigatorio sem correcao vira pendencia e o codigo de saida e 1', async () => {
    const ui = fakeUi();
    const item = { label: 'ssh', check: async () => fail('sem chave'), guide: () => ['gere a chave'] };
    const { exitCode, report } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.equal(exitCode, 1);
    assert.deepEqual(report.fail, ['ssh — sem chave']);
    assert.ok(names(ui, 'guide:').length === 1);
});

test('orienta e repete a verificacao ate o usuario resolver', async () => {
    const ui = fakeUi({ selects: ['verify', 'verify'] });
    let attempts = 0;
    const item = { label: 'acesso', check: async () => (++attempts >= 3 ? pass() : fail('negado')), guide: () => ['cadastre'] };
    const { report } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.deepEqual(report.fixed, ['acesso']);
    assert.equal(attempts, 3);
});

test('escolher pular registra o item como pulado (opcional) ou pendente (obrigatorio)', async () => {
    const ui = fakeUi({ selects: ['skip', 'skip'] });
    const { report } = await runChecklist({
        title: 'T',
        sections: [section(async (r) => {
            await r.ensure({ label: 'a', level: 'optional', check: async () => fail('x') });
            await r.ensure({ label: 'b', check: async () => fail('y') });
        })],
    }, ui);
    assert.deepEqual(report.skip, ['a — x']);
    assert.deepEqual(report.fail, ['b — y']);
});

test('sair interrompe o checklist com codigo 2 e imprime o resumo', async () => {
    const ui = fakeUi({ selects: ['quit'] });
    const { exitCode, stopped } = await runChecklist({
        title: 'T',
        sections: [
            section(async (r) => {
                await r.ensure({ label: 'ja ok', check: async () => pass() });
                await r.ensure({ label: 'a', check: async () => fail('x') });
            }),
            section(() => assert.fail('nao deveria rodar')),
        ],
    }, ui);
    assert.equal(exitCode, 2);
    assert.match(stopped, /saiu/);
    assert.ok(names(ui, 'note:').length === 1);
});

test('Stop lancado por uma correcao encerra com o codigo informado', async () => {
    const ui = fakeUi({ confirms: [true] });
    const item = { label: 'systemd', check: async () => fail('off'), fix: async () => { throw new Stop('Reinicie o WSL.'); } };
    const { exitCode, stopped } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.equal(exitCode, 1);
    assert.equal(stopped, 'Reinicie o WSL.');
});

test('modo checkOnly nao corrige nem pergunta; opcional vira aviso e personal vira pulado', async () => {
    const ui = fakeUi();
    let fixed = false;
    const fix = async () => { fixed = true; };
    const { report } = await runChecklist({
        title: 'T', options: { checkOnly: true },
        sections: [section(async (r) => {
            await r.ensure({ label: 'req', check: async () => fail('1'), fix, guide: () => ['g'] });
            await r.ensure({ label: 'opt', level: 'optional', check: async () => fail('2'), fix });
            await r.ensure({ label: 'pes', level: 'personal', check: async () => fail('3'), fix, guide: () => ['nao mostrar'] });
        })],
    }, ui);
    assert.equal(fixed, false);
    assert.deepEqual([report.fail.length, report.warn.length, report.skip.length], [1, 1, 1]);
    assert.equal(names(ui, 'guide:').length, 1);
});

test('assumeYes aceita as correcoes seguras sozinho, mas opcional so com withOptional', async () => {
    const run = async (options) => {
        const ui = fakeUi({ interactive: false });
        let ran = [];
        await runChecklist({
            title: 'T', options: { assumeYes: true, ...options },
            sections: [section(async (r) => {
                await r.ensure({ label: 'req', check: async () => (ran.includes('req') ? pass() : fail('x')), fix: async () => ran.push('req') });
                await r.ensure({ label: 'opt', level: 'optional', check: async () => (ran.includes('opt') ? pass() : fail('x')), fix: async () => ran.push('opt') });
            })],
        }, ui);
        return ran;
    };
    assert.deepEqual(await run({}), ['req']);
    assert.deepEqual(await run({ withOptional: true }), ['req', 'opt']);
});

test('sem terminal interativo nao pergunta nada e deixa a pendencia', async () => {
    const ui = fakeUi({ interactive: false, confirms: [true] });
    let fixed = false;
    const item = { label: 'a', check: async () => fail('x'), fix: async () => { fixed = true; } };
    const { exitCode } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.equal(fixed, false);
    assert.equal(exitCode, 1);
});

test('uma correcao que lanca erro vira aviso e o item segue o fluxo normal', async () => {
    const ui = fakeUi({ confirms: [true] });
    const item = { label: 'a', check: async () => fail('x'), fix: async () => { throw new Error('quebrou'); } };
    const { report } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.ok(ui.events.some((e) => e.startsWith('warn:') && e.includes('quebrou')));
    assert.equal(report.fail.length, 1);
});

test('secoes recebem o contexto e podem consultar as pendencias', async () => {
    const ui = fakeUi();
    let seen;
    await runChecklist({
        title: 'T', context: { valor: 42 },
        sections: [
            section((r) => r.ensure({ label: 'a', check: async () => fail('x') })),
            section((r) => { seen = { valor: r.ctx.valor, falhas: r.hasFailures() }; }),
        ],
    }, ui);
    assert.deepEqual(seen, { valor: 42, falhas: true });
});

test('formatReport lista so os grupos com itens', () => {
    const text = formatReport({ ok: ['a'], fixed: [], warn: [], skip: [], fail: ['b — x'] });
    assert.match(text, /Ja estava ok \(1\)/);
    assert.match(text, /Pendencias obrigatorias \(1\)/);
    assert.doesNotMatch(text, /Corrigido/);
});

test('autoConfirm corrige sem perguntar, mesmo sem terminal interativo', async () => {
    const ui = fakeUi({ interactive: false });
    let installed = false;
    const item = { label: 'a', autoConfirm: true, check: async () => (installed ? pass() : fail('x')), fix: async () => { installed = true; } };
    const { report } = await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.deepEqual(report.fixed, ['a']);
    assert.ok(!ui.events.some((e) => e.startsWith('confirm:')));
});

test('guide pode ser assincrono', async () => {
    const ui = fakeUi();
    const item = { label: 'a', check: async () => fail('x'), guide: async () => ['linha async'] };
    await runChecklist({ title: 'T', sections: [section((r) => r.ensure(item))] }, ui);
    assert.ok(ui.events.includes('guide:linha async'));
});

test('as secoes alteram o mesmo objeto de contexto recebido', async () => {
    const ui = fakeUi();
    const context = { valor: 1 };
    await runChecklist({ title: 'T', context, sections: [section((r) => { r.ctx.valor = 2; })] }, ui);
    assert.equal(context.valor, 2);
});

test('successMessage pode ser uma funcao do contexto', async () => {
    const ui = fakeUi();
    await runChecklist({
        title: 'T', context: { aviso: 'reinicie' },
        sections: [section(() => {})],
        successMessage: (ctx) => `pronto, ${ctx.aviso}`,
    }, ui);
    assert.ok(ui.events.includes('outro:pronto, reinicie'));
});
