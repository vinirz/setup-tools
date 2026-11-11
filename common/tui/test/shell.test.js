import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, CommandError } from '../src/shell.js';

test('captura a saida de um comando bem-sucedido', async () => {
    const { output } = await run('node', ['-e', 'console.log("ola")']);
    assert.equal(output.trim(), 'ola');
});

test('rejeita com CommandError e traz a saida quando o codigo e diferente de zero', async () => {
    await assert.rejects(
        run('node', ['-e', 'console.error("falhou"); process.exit(3)']),
        (error) => error instanceof CommandError && error.code === 3 && error.output.includes('falhou'),
    );
});

test('rejeita quando o comando nao existe', async () => {
    await assert.rejects(run('comando-inexistente-xyz'), CommandError);
});

test('stream mostra a saida em tempo real e tambem a captura', async () => {
    const forwarded = [];
    const { output } = await run('node', ['-e', 'console.log("ao vivo")'], { stream: true, forward: (chunk) => forwarded.push(String(chunk)) });
    assert.equal(output.trim(), 'ao vivo');
    assert.equal(forwarded.join('').trim(), 'ao vivo');
});

test('timeoutMs encerra o comando e rejeita com codigo timeout', async () => {
    await assert.rejects(
        run('node', ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200 }),
        (error) => error instanceof CommandError && error.code === 'timeout',
    );
});
