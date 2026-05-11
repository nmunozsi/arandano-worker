import { runShell } from '../_shell.js';
export const typecheckGate = (cwd: string) =>
  runShell({ cmd: 'go', args: ['build', './...'], cwd });
