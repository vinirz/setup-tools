import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';
import { NODE_RECOMMENDED_MAJOR, NVM_VERSION, PNPM_VERSION_DEFAULT } from '../config.js';
import { majorOf } from '../parse.js';

const NODE = NODE_RECOMMENDED_MAJOR;

/** Versao do pnpm que o projeto pede ("packageManager" do fullbackend); cai no padrao se o repo ainda nao existe. */
export async function expectedPnpm(ctx) {
    const text = await ctx.readText(join(ctx.nxDir, 'sources', 'nx-suite-fullbackend', 'package.json'));
    try {
        return JSON.parse(text).packageManager?.match(/^pnpm@([0-9][^+]*)/)?.[1] ?? PNPM_VERSION_DEFAULT;
    } catch {
        return PNPM_VERSION_DEFAULT;
    }
}

export function nodeItems(ctx) {
    const globalPackage = (name, label, why, level = 'required', version = async () => '') => ({
        label,
        level,
        fixDesc: `npm install -g ${name}`,
        check: async () => {
            const result = await ctx.nvm(`command -v ${name} >/dev/null && ${name} --version 2>/dev/null | tail -1`);
            return result.ok && result.output.trim() ? pass(`${name} ${result.output.trim()}`) : fail(why);
        },
        fix: async () => ctx.nvmStream(`npm install -g ${name}${await version() ? `@${await version()}` : ''}`),
        guide: async () => [`  npm install -g ${name}${await version() ? `@${await version()}` : ''}`],
    });

    const pnpm = globalPackage('pnpm', 'pnpm', 'pnpm nao instalado (o fullbackend e as migrations usam pnpm; o npm NAO funciona nesse projeto)', 'required', () => expectedPnpm(ctx));
    const pnpmCheck = pnpm.check;
    pnpm.check = async () => {
        const result = await pnpmCheck();
        if (!result.ok) return result;
        const want = await expectedPnpm(ctx);
        const current = result.detail.replace('pnpm ', '');
        return pass(current === want ? result.detail : `${result.detail} (o projeto pede ${want}; o pnpm troca sozinho quando necessario)`);
    };

    return {
        nvm: {
            label: 'nvm (gerenciador do Node)',
            fixDesc: `instalar o nvm ${NVM_VERSION}`,
            check: async () => {
                const result = await ctx.nvm('command -v nvm >/dev/null && nvm --version');
                return result.ok ? pass(`nvm ${result.output.trim()}`) : fail('nvm nao instalado (gerenciador de versoes do Node)');
            },
            fix: () => ctx.bash(`curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash`, { stream: true }),
            guide: () => [
                'Instale o nvm:',
                `  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash`,
                'Depois feche e abra o terminal.',
            ],
        },
        node: {
            label: `Node.js ${NODE} (nvm)`,
            fixDesc: `nvm install ${NODE} e definir como padrao`,
            check: async () => {
                const result = await ctx.nvm('node -v 2>/dev/null; npm -v 2>/dev/null; nvm version default 2>/dev/null');
                const [nodeVersion = '', npmVersion = '', defaultVersion = ''] = result.output.trim().split('\n');
                if (!nodeVersion) return fail('Node.js nao instalado');
                if (majorOf(nodeVersion) !== NODE) {
                    return fail(`Node ativo e ${nodeVersion}; o projeto exige Node ${NODE} (a mesma versao dos Dockerfiles do backend)`);
                }
                if (majorOf(defaultVersion) !== NODE) return fail(`o Node padrao do nvm e ${defaultVersion || 'indefinido'}; deveria ser o ${NODE}`);
                return pass(`${nodeVersion} · npm ${npmVersion}`);
            },
            fix: () => ctx.nvmStream(`nvm install ${NODE} && nvm alias default ${NODE} && nvm use ${NODE}`),
            guide: () => [`  nvm install ${NODE} && nvm alias default ${NODE} && nvm use ${NODE}`],
        },
        pnpm,
        pm2: globalPackage('pm2', 'PM2', 'pm2 nao instalado (o "nx start" sobe os servicos via PM2)'),
        yarn: globalPackage('yarn', 'yarn', 'yarn nao instalado (so projetos antigos com craco usam)', 'optional'),
    };
}

export const nodeSection = {
    title: `Node.js ${NODE} (nvm), npm, pnpm e PM2`,
    why: [
        `Os servicos rodam em Node.js ${NODE}. O nvm permite ter varias versoes lado a lado. O projeto principal (fullbackend) usa`,
        'pnpm (NAO use "npm i" nele) e o comando "nx start" sobe os servicos de teste com PM2.',
    ],
    run: async (runner) => {
        const items = nodeItems(runner.ctx);
        await runner.ensure(items.nvm);
        await runner.ensure(items.node);
        await runner.ensure(items.pnpm);
        await runner.ensure(items.pm2);
        await runner.ensure(items.yarn);
    },
};
