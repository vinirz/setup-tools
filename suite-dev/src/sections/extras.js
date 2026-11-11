import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, pass } from '../../../common/tui/src/index.js';

const AWS_CLI_DOCS = 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html';

export function extrasItems(ctx) {
    const commandItem = ({ command, label, why, detail, fix, fixDesc, guide }) => ({
        label,
        level: 'optional',
        fixDesc,
        fix,
        guide,
        check: async () => {
            const result = await ctx.capture('sh', ['-c', `command -v ${command} >/dev/null && ${detail}`]);
            return result.ok ? pass(result.output.trim().split('\n')[0]) : fail(why);
        },
    });

    const installAwsCli = async () => {
        const dir = await mkdtemp(join(tmpdir(), 'awscli-'));
        try {
            const zip = join(dir, 'awscliv2.zip');
            await ctx.x('curl', ['-fsSL', `https://awscli.amazonaws.com/awscli-exe-linux-${ctx.platform.arch}.zip`, '-o', zip]);
            await ctx.x('unzip', ['-q', zip, '-d', dir]);
            if (!await ctx.ensureSudo()) return false;
            await ctx.x('sudo', [join(dir, 'aws', 'install'), '--update']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
        return true;
    };

    return [
        commandItem({
            command: 'aws', label: 'AWS CLI', detail: 'aws --version 2>&1 | cut -d" " -f1',
            why: 'AWS CLI nao instalado (usado para ECR/S3 e acessos AWS)',
            fix: installAwsCli, fixDesc: 'baixar o instalador oficial',
            guide: () => [`Guia oficial: ${AWS_CLI_DOCS}`],
        }),
        {
            label: 'Credenciais AWS',
            level: 'optional',
            check: async () => ((await ctx.readText(join(ctx.home, '.aws', 'credentials'))).trim()
                ? pass('~/.aws/credentials presente')
                : fail('~/.aws/credentials nao existe (peca as credenciais de desenvolvimento e rode "aws configure")')),
            guide: () => ['  aws configure', 'Peca ao time a Access Key de desenvolvimento. Nunca commite este arquivo.'],
        },
        commandItem({
            command: 'openvpn', label: 'openvpn', detail: 'echo openvpn presente',
            why: 'openvpn ausente (so o comando "nx vpn" usa)',
            fixDesc: 'apt-get install openvpn',
            fix: async () => {
                if (!await ctx.ensureSudo()) return false;
                await ctx.x('sudo', ['apt-get', 'install', '-y', 'openvpn']);
                return true;
            },
            guide: () => ['  sudo apt-get install -y openvpn'],
        }),
        commandItem({
            command: 'ngrok', label: 'ngrok', detail: 'ngrok version | head -1',
            why: 'ngrok ausente (usado para expor canais WhatsApp/Telegram/Instagram nos testes)',
            guide: () => [
                'Baixe em https://ngrok.com/download (Linux) e configure o token:',
                '  ngrok config add-authtoken <SEU_TOKEN>',
                'O "nx config-ngrok" espera o arquivo ~/.config/ngrok/ngrok.yml.',
            ],
        }),
        commandItem({
            command: 'mongosh', label: 'mongosh', detail: 'mongosh --version',
            why: 'mongosh ausente (so o "nx connect-setup" e consultas manuais no Mongo usam)',
            guide: () => ['Instalacao: https://www.mongodb.com/docs/mongodb-shell/install/'],
        }),
    ];
}

export const extrasSection = {
    title: 'Ferramentas complementares (opcionais)',
    why: [
        'Nada aqui impede o setup. Sao usadas por comandos especificos do toolkit (VPN, ngrok, AWS, Mongo).',
        'Para instalar sem perguntar use --with-optional. Itens sem instalador automatico mostram o passo a passo.',
    ],
    run: async (runner) => {
        for (const item of extrasItems(runner.ctx)) await runner.ensure(item);
    },
};
