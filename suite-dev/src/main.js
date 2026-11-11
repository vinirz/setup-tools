// Entrada minima: aplica --no-color ANTES de carregar a TUI (as cores sao decididas no import).
const argv = process.argv.slice(2);
if (argv.includes('--no-color')) process.env.NO_COLOR = '1';

const { cli } = await import('./cli.js');
process.exitCode = await cli(argv);
