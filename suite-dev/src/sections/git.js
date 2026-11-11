import { fail, pass } from '../../../common/tui/src/index.js';

export function gitItems(ctx) {
    const config = (key) => ctx.capture('git', ['config', '--global', key]).then((result) => result.output.trim());

    return {
        installed: {
            label: 'Git instalado',
            fixDesc: 'apt-get install git',
            check: async () => {
                const result = await ctx.capture('git', ['--version']);
                return result.ok ? pass(result.output.trim()) : fail('git nao instalado');
            },
            fix: async () => {
                if (!await ctx.ensureSudo()) return false;
                await ctx.x('sudo', ['apt-get', 'update']);
                await ctx.x('sudo', ['apt-get', 'install', '-y', 'git']);
            },
            guide: () => ['  sudo apt-get update && sudo apt-get install -y git'],
        },
        identity: {
            label: 'Identidade do git (nome/e-mail)',
            fixDesc: 'perguntar seu nome e e-mail',
            check: async () => {
                const [name, email] = await Promise.all([config('user.name'), config('user.email')]);
                return name && email ? pass(`${name} <${email}>`) : fail('user.name/user.email nao configurados (seus commits ficariam sem autoria)');
            },
            fix: async () => {
                if (!ctx.ui.interactive) return false;
                const name = (await ctx.ui.text('Seu nome completo (aparece nos commits):')).trim();
                const email = (await ctx.ui.text('Seu e-mail da empresa (o mesmo do Bitbucket):')).trim();
                if (!name || !email) {
                    ctx.ui.warn('Nome e e-mail sao obrigatorios.');
                    return false;
                }
                await ctx.x('git', ['config', '--global', 'user.name', name]);
                await ctx.x('git', ['config', '--global', 'user.email', email]);
            },
            guide: () => [
                '  git config --global user.name "Seu Nome"',
                '  git config --global user.email "seu.email@empresa.com"',
            ],
        },
        autocrlf: {
            label: 'Fim de linha do git (autocrlf)',
            level: 'optional',
            fixDesc: 'git config core.autocrlf input',
            check: async () => {
                const value = await config('core.autocrlf');
                if (value === 'input' || value === 'false') return pass(`core.autocrlf=${value}`);
                return fail(`core.autocrlf=${value || '(nao definido)'}; no WSL o ideal e "input" (evita ^M / CRLF quebrando scripts e .env)`);
            },
            fix: () => ctx.x('git', ['config', '--global', 'core.autocrlf', 'input']),
            guide: () => ['  git config --global core.autocrlf input'],
        },
    };
}

export const gitSection = {
    title: 'Git',
    why: [
        'O codigo fica em repositorios git. Precisa do git instalado, da sua identidade (nome/e-mail) e de uma configuracao',
        'de fim de linha segura (o Windows usa CRLF e isso quebra scripts .sh e arquivos .env no Linux).',
    ],
    run: async (runner) => {
        const items = gitItems(runner.ctx);
        if (!await runner.ensure(items.installed)) return;
        await runner.ensure(items.identity);
        await runner.ensure(items.autocrlf);
    },
};
