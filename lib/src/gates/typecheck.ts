import { runShell } from './_shell.js';
export const typecheckGate = (cwd: string) =>
  runShell({ cmd: 'npx', args: ['tsc', '--noEmit'], cwd });
