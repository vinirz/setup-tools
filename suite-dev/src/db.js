import { POSTGRES } from './config.js';

/** Quantidade de migrations aplicadas no banco principal; null se nao deu para consultar. */
export async function appliedMigrations(ctx) {
    const result = await ctx.dk([
        'exec', POSTGRES.container, 'psql', '-U', POSTGRES.user, '-d', POSTGRES.database,
        '-tAc', 'select count(*) from public.pgmigrations',
    ]);
    const count = result.output.trim();
    return result.ok && /^\d+$/.test(count) ? Number(count) : null;
}

/** Nomes dos containers em execucao. */
export async function runningContainers(ctx) {
    const result = await ctx.dk(['ps', '--format', '{{.Names}}']);
    return result.ok ? result.output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}
