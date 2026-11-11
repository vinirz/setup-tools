import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.js';

function fakeUi() {
    const events = [];
    const record = (name) => (message) => events.push(`${name}:${message}`);
    return {
        events,
        intro: record('intro'), outro: record('outro'), info: record('info'),
        success: record('success'), warn: record('warn'), error: record('error'), step: record('step'),
        spinner: () => ({
            start: record('start'), stop: record('stop'), error: record('spinner-error'),
        }),
    };
}

test('executa as etapas em ordem e termina com sucesso', async () => {
    const ui = fakeUi();
    const order = [];
    const steps = [
        { title: 'A', run: async () => order.push('A') },
        { title: 'B', run: async () => order.push('B') },
    ];

    const result = await runPipeline({ title: 'P', steps }, ui);

    assert.deepEqual(order, ['A', 'B']);
    assert.deepEqual(result, { ok: true });
    assert.ok(ui.events.includes('outro:Tudo pronto.'));
});

test('pula a etapa quando skip retorna true', async () => {
    const ui = fakeUi();
    let ran = false;
    const steps = [{ title: 'A', skip: async () => true, run: async () => { ran = true; } }];

    const result = await runPipeline({ title: 'P', steps }, ui);

    assert.equal(ran, false);
    assert.equal(result.ok, true);
    assert.ok(ui.events.some((e) => e.startsWith('info:A')));
});

test('para na primeira falha e informa a etapa', async () => {
    const ui = fakeUi();
    const order = [];
    const steps = [
        { title: 'A', run: async () => order.push('A') },
        { title: 'B', run: async () => { throw Object.assign(new Error('boom'), { output: 'linha1\nlinha2' }); } },
        { title: 'C', run: async () => order.push('C') },
    ];

    const result = await runPipeline({ title: 'P', steps }, ui);

    assert.deepEqual(order, ['A']);
    assert.deepEqual(result, { ok: false, failedStep: 'B' });
    assert.ok(ui.events.includes('spinner-error:B falhou'));
    assert.ok(ui.events.includes('error:linha1\nlinha2'));
});

test('etapa interativa nao usa spinner', async () => {
    const ui = fakeUi();
    const steps = [{ title: 'sudo', interactive: true, run: async () => {} }];

    await runPipeline({ title: 'P', steps }, ui);

    assert.ok(ui.events.includes('step:sudo'));
    assert.ok(!ui.events.some((e) => e.startsWith('start:')));
});

test('compartilha o contexto entre as etapas', async () => {
    const ui = fakeUi();
    const steps = [
        { title: 'A', run: async (ctx) => { ctx.value = 42; } },
        { title: 'B', run: async (ctx) => { if (ctx.value !== 42) throw new Error('sem contexto'); } },
    ];

    const result = await runPipeline({ title: 'P', steps }, ui);

    assert.equal(result.ok, true);
});

test('etapa opcional que falha avisa e nao interrompe a pipeline', async () => {
    const ui = fakeUi();
    const order = [];
    const steps = [
        { title: 'A', optional: true, run: async () => { throw new Error('indisponivel'); } },
        { title: 'B', run: async () => order.push('B') },
    ];

    const result = await runPipeline({ title: 'P', steps }, ui);

    assert.deepEqual(order, ['B']);
    assert.equal(result.ok, true);
    assert.ok(ui.events.some((e) => e.startsWith('warn:A: indisponivel')));
});

test('as etapas recebem a interface (ui) no contexto', async () => {
    const ui = fakeUi();
    let received;
    const steps = [{ title: 'A', run: async (ctx) => { received = ctx.ui; } }];

    await runPipeline({ title: 'P', steps }, ui);

    assert.equal(received, ui);
});

test('usa a mensagem final personalizada', async () => {
    const ui = fakeUi();

    await runPipeline({ title: 'P', steps: [], successMessage: 'Feito!' }, ui);

    assert.ok(ui.events.includes('outro:Feito!'));
});
